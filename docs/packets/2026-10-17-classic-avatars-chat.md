# Classic avatars and shared NorthStar chat

Account and chat now use the approved 45 original 34x23 Yahoo Games sprites. Preferences persist by server-authenticated actor in SQLite; callers cannot select an arbitrary URL or another actor. Existing NorthStar messages resolve the author's current avatar; Teams/system messages use the default. No newer creator artwork is included.

The Account card and chat header open an accessible classic picker. Chat includes avatars, dates, timestamps, inline send failures, retained drafts and scroll preservation. The operator composer has its own ID so it no longer collides with the AI input.

`northstar-chat.html` serves the same protected conversation to Games. A strict source/origin bridge exchanges only the avatar ID. The launcher provides open(), chooseAvatar(), profile, and mount(container,{theme:'classic',compact:true}). Compact chess mode scrolls the transcript above a bottom composer. Games sign-in remains separate; the iframe uses the dashboard session and includes a sign-in/reconnect fallback.

## Integration
- Base: 1a0b662ef212247ef634ef83ca9de8e46d77e22e.
- Branch: codex/classic-avatars-chat-20261017.
- Canonical integration must acquire the existing coordinator lock and preserve dashboard-layout-default.js.
- Restart dashboard Python after integration to initialize the additive profile table.
- Games changes live in the separately hosted poker-study runtime: four HTML includes, two launcher assets, 45 PNGs, exact static allowlist and ops-only frame-src. Chess owner supplied the lower-panel mount and profile bridge; their separate Stockfish changes are not this packet's implementation.
- Host-only auth cookies and public check-in allowlists are unchanged. No Teams connection is enabled.

## Verification
Full Python suite: 511 passed, 21 skipped (optional PostgreSQL/browser integration configuration absent locally), zero failures. Five focused avatar tests and three release status tests also passed. Packaged-release results are recorded in the delivery handoff. Browser fixture verifies all 45 choices, persisted selection, message rendering, escaped HTML, sending/failure draft retention, mobile layout, compact composer fit, and trusted iframe bridge, including same-origin local desktop hosting. 71 JavaScript tests passed. Games WSGI: 8 web tests passed; all 45 served PNGs hash-match the approved archive; unexpected sprite paths return404. Production authentication and hosted iframe rendering remain separate acceptance checks.

## v0.222 correction
The first hosted run (39081608631) passed Python and PostgreSQL but caught the floating Chat button intercepting Edit Layout clicks. Dashboard-only chat controls now sit above the layout toolbar and hide while editing; Games positioning is unchanged. The avatar browser fixture now exercises a real layout-button click and verifies editing visibility. That fixture and all 71 Node tests passed. Python runtime code is unchanged from the 511-pass/21-skip full run. A local run of the larger overview-chart fixture timed out waiting for its initial chart canvas, before the affected control; the final hosted run remains the comprehensive rendered gate.
