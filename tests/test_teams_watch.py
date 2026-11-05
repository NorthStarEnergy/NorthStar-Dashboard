import copy
from datetime import datetime, timedelta, timezone
import json
from urllib.parse import quote

import pytest

import northstar_event_register as register
import northstar_store as store
import northstar_teams_watch as watch

RESOURCE = 'teams/test-team/channels/19:operations@thread.tacv2/messages'


@pytest.fixture
def config(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB_PATH', tmp_path / 'test.db')
    with store._session() as connection:
        connection.executescript(store.SCHEMA)
    return {'enabled': True, 'tenantId': '00000000-0000-4000-8000-000000000001',
            'clientId': '00000000-0000-4000-8000-000000000002',
            'intervalSeconds': 60, 'maxPages': 20, 'startAt': '2026-09-28T00:00:00Z',
            'sources': [{'resource': RESOURCE, 'label': 'Test Operations'}]}


def message(id='root', **extra):
    return {'id': id, 'createdDateTime': '2026-09-28T10:00:00Z',
            'lastModifiedDateTime': '2026-09-28T10:00:00Z',
            'from': {'user': {'displayName': 'Test Operator'}},
            'body': {'contentType': 'html', 'content': '<p>Test message</p><script>bad()</script>'},
            'webUrl': 'https://teams.microsoft.com/l/message/test', **extra}


class FakeGraph:
    def __init__(self, root=None, replies=None, failure=None):
        self.root = root if root is not None else [message()]
        self.replies = replies if replies is not None else [message('reply')]
        self.failure = failure
        self.calls = []

    def get(self, url, resource):
        self.calls.append(url)
        if '/replies?' in url:
            if self.failure:
                raise self.failure
            return {'value': self.replies}
        return {'value': self.root}


def rows():
    with store._session() as connection:
        return connection.execute('SELECT * FROM audit_events ORDER BY rowid').fetchall()


def test_roots_replies_retries_edits_and_deletion_reach_existing_register(config):
    graph = FakeGraph()
    assert watch.run_once(config, graph)[0]['inserted'] == 2
    assert watch.run_once(config, graph)[0]['inserted'] == 0
    recorded = rows()
    assert len({row['correlation_id'] for row in recorded}) == 1
    assert json.loads(recorded[1]['payload'])['threadId'] == 'root'
    assert json.loads(recorded[0]['payload'])['details'] == 'Test message'
    graph.root = [message(lastModifiedDateTime='2026-09-28T11:00:00Z')]
    assert watch.run_once(config, graph)[0]['inserted'] == 1
    graph.root = [message(deletedDateTime='2026-09-28T12:00:00Z')]
    assert watch.run_once(config, graph)[0]['inserted'] == 1
    assert len(rows()) == 4
    assert len({row['aggregate_id'] for row in rows() if json.loads(row['payload'])['sourceMessageId'] == 'root'}) == 1
    result = register.register({'source': ['teams']})
    assert result['total'] == 4
    assert register.detail(recorded[0]['event_id'], {})


def test_failed_reply_page_rolls_back_source_and_records_error(config):
    result = watch.run_once(config, FakeGraph(failure=watch.WatchError('Graph HTTP 429', 120)))
    assert result[0]['state'] == 'error' and result[0]['retryAfter'] == 120
    assert not rows()
    with store._session() as connection:
        health = connection.execute('SELECT * FROM teams_watch_health').fetchone()
    assert health['last_success'] is None and health['state'] == 'error'


def test_old_root_does_not_hide_new_reply(config):
    graph = FakeGraph(root=[message(createdDateTime='2026-09-01T00:00:00Z', lastModifiedDateTime='2026-09-01T00:00:00Z')])
    assert watch.run_once(config, graph)[0]['inserted'] == 1
    assert json.loads(rows()[0]['payload'])['sourceMessageId'] == 'reply'


def test_chat_does_not_request_replies_and_scopes_are_read_only(config):
    config['sources'] = [{'resource': 'chats/approved-chat/messages', 'label': 'Approved chat'}]
    graph = FakeGraph()
    assert watch.run_once(config, graph)[0]['inserted'] == 1
    assert len(graph.calls) == 1
    assert watch.scopes(config) == ['Chat.Read']


@pytest.mark.parametrize('url', [
    'https://evil.example/v1.0/' + RESOURCE,
    'http://graph.microsoft.com/v1.0/' + RESOURCE,
    'https://graph.microsoft.com.evil.example/v1.0/' + RESOURCE,
    'https://graph.microsoft.com/v1.0/chats/other/messages',
    'https://graph.microsoft.com/v1.0/' + RESOURCE + '/../messages',
    'https://graph.microsoft.com/v1.0/' + RESOURCE + '/%2e%2e/replies',
    'https://user:password@graph.microsoft.com/v1.0/' + RESOURCE,
])
def test_pagination_cannot_leak_token_or_read_another_source(url):
    with pytest.raises(watch.WatchError):
        watch.validate_url(url, RESOURCE)


def test_pagination_all_pages_and_limit_are_honest():
    base = watch.GRAPH + quote(RESOURCE, safe='/')
    class Paged:
        def get(self, url, resource):
            return {'value': [message()], '@odata.nextLink': base + '?page=2'} if '?' not in url else {'value': [message('second')]}
    assert len(list(watch.pages(Paged(), base, RESOURCE, [2]))) == 2
    with pytest.raises(watch.WatchError, match='incomplete'):
        list(watch.pages(Paged(), base, RESOURCE, [1]))


def test_invalid_message_does_not_leave_partial_source(config):
    assert watch.run_once(config, FakeGraph(replies=[message('bad', createdDateTime='not-a-date')]))[0]['state'] == 'error'
    assert not rows()


def test_disabled_and_unapproved_configuration_never_connect(config, tmp_path):
    path = tmp_path / 'config.json'
    for changes in ({'enabled': False}, {'tenantId': 'consumers'}, {'sources': []},
                    {'sources': [{'resource': 'users/all/messages', 'label': 'Bad'}]}):
        path.write_text(json.dumps({**config, **changes}))
        with pytest.raises((watch.WatchError, ValueError)):
            watch.load_config(path)
    path.write_text(json.dumps(config))
    assert watch.load_config(path)['sources'] == config['sources']


def test_throttle_stops_remaining_sources(config):
    config['sources'].append({'resource': 'chats/second/messages', 'label': 'Second'})
    graph = FakeGraph(failure=watch.WatchError('Throttled', 60))
    assert len(watch.run_once(config, graph)) == 1
    assert not any('second' in url for url in graph.calls)


def test_db_failure_rolls_back_source(config, monkeypatch):
    append = watch.microsoft.events.append_event
    def fail_second(connection, **envelope):
        if envelope['payload']['sourceMessageId'] == 'reply':
            raise watch.sqlite3.OperationalError('test failure')
        return append(connection, **envelope)
    monkeypatch.setattr(watch.microsoft.events, 'append_event', fail_second)
    assert watch.run_once(config, FakeGraph())[0]['state'] == 'error'
    assert not rows()
