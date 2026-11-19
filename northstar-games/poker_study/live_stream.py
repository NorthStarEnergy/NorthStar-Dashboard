"""Issue private playback links only for authenticated Games viewers."""
import json
import os
import re
from urllib.request import Request, urlopen


def live_response(member):
    shell = ('<!doctype html><html lang="en"><meta charset="utf-8">'
             '<meta name="viewport" content="width=device-width,initial-scale=1">'
             '<title>Watch Live · NorthStar Games</title><link rel="stylesheet" href="/hub.css">'
             '<main><a href="/">NorthStar Games</a><h1>Watch Live</h1>')

    def message(status, body):
        return status, shell + body + '</main></html>', None

    if not member:
        return message('401 Unauthorized', '<p>Sign in through the account menu in the Games lobby, then open Watch Live.</p><a href="/">Open lobby</a>')
    account, live_id, customer, secret = (os.environ.get('NS_STREAM_' + key, '').strip()
                                          for key in ('ACCOUNT', 'INPUT', 'CUSTOMER', 'API_TOKEN'))
    if not (all(re.fullmatch('[a-fA-F0-9]{32}', uid) for uid in (account, live_id))
            and re.fullmatch('[a-z0-9-]{1,52}', customer) and secret):
        return message('503 Service Unavailable', '<p>The broadcaster has not connected a live input yet.</p>')
    base = f'https://api.cloudflare.com/client/v4/accounts/{account}/stream'
    def call(path, method):
        request = Request(base + path, method=method, headers={'Authorization': 'Bearer ' + secret})
        with urlopen(request, timeout=5) as response:
            return json.load(response)['result']
    try:
        settings = call('/live_inputs/' + live_id, 'GET')
        if settings['recording'].get('requireSignedURLs') is not True:
            return message('503 Service Unavailable', '<p>The broadcaster must enable private playback.</p>')
        token = call('/' + live_id + '/token', 'POST')['token']
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', token):
            raise ValueError('Invalid playback token')
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return message('503 Service Unavailable', '<p>The broadcast service is unavailable. Reload to reconnect.</p>')
    host = f'customer-{customer}.cloudflarestream.com'
    return ('200 OK', shell + f'<iframe title="Live broadcast" width="100%" height="480" '
            f'src="https://{host}/{token}/iframe" allowfullscreen></iframe>'
            '<p>If playback expires, reload to reconnect.</p></main></html>', host)
