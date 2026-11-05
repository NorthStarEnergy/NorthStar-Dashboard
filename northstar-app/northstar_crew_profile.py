"""Account-scoped crew button positions, stored in the application database."""
import json
import math
import northstar_store as store
CODES = {'TW','IR','IR TS','IS','OW','WO','CT','BB','CL','SF','FF','FF TS','KE','NO','OK','A1','A2','CG','MC','B1','B2'}
def layout(owner, positions=None):
    if not owner:
        raise ValueError('Signed-in account required')
    if positions is not None:
        if not isinstance(positions, dict) or set(positions) != CODES:
            raise ValueError('All configured site positions are required')
        clean = {}
        for code, point in positions.items():
            if not isinstance(point, dict):
                raise ValueError('Invalid position')
            x, y = point.get('x'), point.get('y')
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (x,y)) or not 0 <= x <= 75 or not 0 <= y <= 2000:
                raise ValueError('Invalid position')
            clean[code] = {'x':x,'y':y}
    with store._session() as db:
        db.execute('CREATE TABLE IF NOT EXISTS crew_profile_layout (owner TEXT PRIMARY KEY, positions TEXT NOT NULL)')
        if positions is not None:
            db.execute('INSERT INTO crew_profile_layout VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET positions=excluded.positions', (owner,json.dumps(clean)))
        row = db.execute('SELECT positions FROM crew_profile_layout WHERE owner=?',(owner,)).fetchone()
        return {'positions':json.loads(row['positions']) if row else {}}
