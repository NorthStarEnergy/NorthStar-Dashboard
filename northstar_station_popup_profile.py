"""Account-scoped size preference for the generating-station popup."""
import json
import math

import northstar_store as store


def preference(owner, value=None):
    if not owner:
        raise ValueError('Signed-in account required')
    clean = None
    if value is not None:
        if not isinstance(value, dict) or not isinstance(value.get('useSaved'), bool):
            raise ValueError('Invalid popup size preference')
        size = value.get('savedSize')
        if value['useSaved']:
            if not isinstance(size, dict):
                raise ValueError('Saved size is required')
            width, height = size.get('width'), size.get('height')
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (width, height)):
                raise ValueError('Invalid popup dimensions')
            if not 420 <= width <= 3000 or not 280 <= height <= 2000:
                raise ValueError('Popup dimensions are outside the allowed range')
            clean = {'useSaved': True, 'savedSize': {'width': round(width), 'height': round(height)}}
        else:
            clean = {'useSaved': False, 'savedSize': None}
    with store._session() as db:
        db.execute('CREATE TABLE IF NOT EXISTS station_popup_profile (owner TEXT PRIMARY KEY, preference TEXT NOT NULL)')
        if clean is not None:
            db.execute('INSERT INTO station_popup_profile VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET preference=excluded.preference', (owner, json.dumps(clean)))
        row = db.execute('SELECT preference FROM station_popup_profile WHERE owner=?', (owner,)).fetchone()
        return json.loads(row['preference']) if row else {'useSaved': False, 'savedSize': None}
