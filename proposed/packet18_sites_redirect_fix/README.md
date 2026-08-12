# Packet 18 §18.4 — Sites/`auth.js` fix feasibility

**Status: assessed and written 2026-08-12. `index.js` is preserved as the reviewed
reference implementation. An equivalent fail-closed redirect is now in the tracked
`server/index.js`; the current Vinext Sites deployment does not use this retired
entrypoint, so no separate Sites deployment was required.**

## The question this answers

Packet 18 asked whether the same fix pattern that closed the primary fake-login
pipeline (`app/Gate.tsx` redirecting to `ops.northstarenergy.ca` instead of
authenticating locally) could be applied to the second pipeline — the
OpenAI/Codex-hosted "Sites" build (`build.mjs`, `server/index.js`, `auth.js`,
`.openai/hosting.json` project id `appgprj_6a68048f7a148191a140fcb20a1b90ec`).

**Yes — architecturally it's an even better fit here than it was for `Gate.tsx`.**
Before consolidation, `server/index.js` was a single Cloudflare Worker `fetch`
handler that served static assets and injected `<script src="/auth.js"></script>`. Replacing its
body with an immediate `Response.redirect(...)` is structurally simpler than what
`Gate.tsx` had to do (that one redirects from inside a mounted React component's
`useEffect`, since a Worker fetch handler has no client lifecycle to wait on).

## Why a redirect, not just deleting `auth.js`'s credential check

Removing the fake credential check but leaving this pipeline's own content in place
would still be wrong. This session found something new while checking: the content
`index.html`/`app.js` serve behind that login is not the real dashboard
(`northstar-clean.html`) — it's an old, disconnected mock. Its "Crew Check-ins"
panel lets someone type a name and site and click "CHECK IN TO TEAMS →"; the click
handler only writes a confirmation sentence into the page
(`"{name} checked in at {site}. Teams post and Outlook notification queued."`) — it
never calls `/api/checkins` or anything else. Nothing is recorded, nobody is
notified. Documented in `AGENTS.md` as a second, more serious finding alongside the
original fake-login one. A visitor who reached this URL instead of the real
`checkin.northstarenergy.ca` and used this panel would see success while nothing
happened.

Given that, patching only the login and leaving this page reachable behind a *real*
login still leaves a convincing fake safety check-in flow live. Redirecting the
whole pipeline to the real, protected console removes both problems in one change,
the same way `Gate.tsx`'s fix did for the Next.js entry point.

## What's genuinely NOT resolved by writing this file

This is architecturally straightforward, but deploying it is not purely a
mechanical decision — it inherits the open question already sitting in `AGENTS.md`:
**does this Sites surface need to keep existing, and for what?** Three real
possibilities, not mine to pick between:

1. It's dead weight from an earlier iteration and should be redirected (this file)
   or taken down entirely.
2. It's meant to be a genuine public-facing page (marketing/status page) distinct
   from the operator console — in which case redirecting it to `ops.` (which
   requires an employee Cloudflare Access login) is the *wrong* fix, and what it
   actually needs is real, honest, non-operational content with the fake
   login/check-in removed instead.
3. Someone intends to actively maintain it as a second real interface to
   NorthStar — in which case it needs the same authorization and data-integrity
   work the primary path already has (verified JWT, real `/api/checkins` calls,
   etc.), not a redirect.

This document and the accompanying `index.js` make option 1 trivial to execute if
that's the answer. They don't make that decision.

## Current disposition

1. The live entrypoint already redirects to the protected operator console, and the
   legacy source path is fail-closed. No further deployment is required for this fix.
2. If an owner ever revives this pipeline, keep the redirect, remove the old mock
   assets, and run the current release pre-flight and security regression checks
   before publishing anything.
 4. `AGENTS.md` records the live-route verification and the source hardening. If a
    future release process starts using the retired entrypoint again, keep the
    fail-closed redirect and do not restore the old static bundle.
