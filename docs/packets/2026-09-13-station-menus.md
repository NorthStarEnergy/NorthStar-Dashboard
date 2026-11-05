# Station menus — 2026-09-13

Each generating station in the Tools Library now opens with a first set of menus: **Info**, **Operating Conditions**, and **Data**.

## Available behavior

- Those three menus are the first children under every West, East, and Quebec generating station.
- **Info** holds the station equipment folders (Powerhouse, Switchyard, Protection & Control, Waterways, Station Service).
- **Operating Conditions** stays **Setup pending**. It does not invent readings and does not command equipment.
- **Data** is the station data surface. The read-only Maximo pane loads here and stays Setup pending until authorized credentials are present.
- Device and folder identities are unchanged. Notes remain append-only and still do not acknowledge alarms.

## Validation

Full Python suite: 226 passed. Coverage includes the station menu order, equipment nested under Info, empty Operating Conditions / Data children, no invented condition readings, and Maximo attached to the station and Data menu only.

## Activation required

Python catalog changes need a backend restart. Static Tools HTML/JS/CSS (`?v=20260913-3`) are served from disk on the next operator refresh.
