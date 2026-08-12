// Reference replacement for server/index.js — Packet 18 §18.4 / the second
// fake-login pipeline. Written 2026-08-12. An equivalent redirect is now in the
// tracked server/index.js; the current Vinext build does not use this retired file.
//
// Same fix pattern as app/Gate.tsx (applied earlier this session to the Next.js
// entry point): stop serving this pipeline's own content and immediately redirect
// to the real Access-protected operator console. Architecturally this is an easier
// fit here than in Gate.tsx — Gate.tsx had to redirect from inside a mounted React
// component; this is a single Cloudflare Worker fetch handler, so the redirect is
// the entire handler.
//
// This isn't only a login fix. AGENTS.md (see the "Second finding, added
// 2026-08-12" note) documents that the content this pipeline serves behind its fake
// login — index.html / app.js — includes a Crew Check-in panel that claims to post
// to Teams and send Outlook notifications but does neither; it only writes a
// confirmation string into the page. A visitor who used this instead of the real
// checkin.northstarenergy.ca would see a false "you're checked in" message. Removing
// only auth.js and leaving that page reachable behind a *real* login would still
// leave that specific danger in place. Redirecting the whole surface removes both
// problems at once.

const OPERATOR_CONSOLE_URL = 'https://ops.northstarenergy.ca/';

export default {
  async fetch(request) {
    return Response.redirect(OPERATOR_CONSOLE_URL, 302);
  },
};
