# Dashboard asset connection backlog — 2026-09-15

A concurrent read-only request for the dashboard's 51 JS/CSS assets reproduced six Windows connection resets against the running backend. NorthstarHTTPServer inherited the Python 3.13 TCP backlog of five; the tunnel can deliver more pending connections during navigation. The server now requests a backlog of 128 while retaining loopback binding, exclusive port ownership, threaded handling and all operator gates.

A regression opens 64 connections while accept is paused, ensuring the full navigation burst can wait instead of being rejected. Full suite and isolated release checks are recorded in the package. The existing unrelated demo-login actor changes are excluded from this commit.

Activation requires a backend restart. The elevated running Python process denied Stop-Process from the agent session. The original scheduled task was started again and Administrator restart instructions supplied. Until that restart, production still runs the old backlog. Follow-up should repeat the 51-asset burst and verify no resets plus unchanged gate/hostname behavior.
