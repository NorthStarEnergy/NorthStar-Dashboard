# Desktop header and dark title bar — 2026-10-22

## Request
Fix overlapping sidebar branding, then replace the desktop dashboard's light title/menu bars with a single dark bar: hamburger left and native minimize/maximize/close right.

## Implementation
Scoped desktop sidebar grid correction, compact menu sizing, narrow-window stacking, avatar dimensions and popup stacking. Manager dashboard now uses a local sandboxed shell with dark Windows title-bar overlay and a separate sandboxed WebContentsView below its 36px header. Hamburger contains profile/avatar, chat, reload, editing, zoom, fullscreen and window actions. Native File/Edit bar and duplicate sidebar hamburger are hidden in the new desktop shell. Browser menu remains unchanged. Source manager and installed manager entrypoints updated independently to preserve their different launch configurations.

## Runtime
C:/Users/User/NorthStar/northstar-local and C:/Users/User/NorthStar/manager/NorthStar Manager Runtime/resources/app. Static CSS is live; close and reopen Manager to load the new Electron main process. Existing running user app was not forcibly closed. Backend/tunnel unaffected.

## Verification
Three full-HTML Electron-UA browser fixtures at 1600, 1280 and 1024 pixels verify non-overlapping controls, contained popup, profile visibility, chat open/close. Layout recovery passes. Actual installed Electron runtime tested in isolated user-data directory: Manager dashboard action opens shell, menu bar hidden, content below title bar, sandbox and context isolation retained; native maximize/restore/minimize/close and hamburger pass. OS window capture visually confirms dark title bar and native controls. Tests use fixture page, not user's authenticated records. Manager lifecycle/reuse test passes. Public CSS hash matches runtime. Python suite:145 passed,46 subtests passed before existing missing database-foundation/schema.sql failure.

## Security and limits
Only local shell main-frame IPC opens the menu; dashboard receives no Node or privileged preload access. Profile/chat callbacks execute fixed commands only on configured dashboard origin. Original migrated runtime lacks Git history/GitHub remote; task's remote belongs to retired Sites deployment and is not used for pushing these changes. Missing research catalog remains explicitly unavailable.

## Recovery
Private preimages retained in task workspace. Manifest records runtime hashes. Restore only these changed files after comparing subsequent edits. New desktop shell files are additive.

## Handoff
Installed and verified. User must reopen NorthStar Manager for title-bar changes. Commit/tag retained in task workspace; allowlisted package copied to Work Projects/NorthStar.
