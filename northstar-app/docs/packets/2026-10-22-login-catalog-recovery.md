# Dashboard login loading recovery — 2026-10-22

## Request
Fix the dashboard error shown after login.

## Cause
Migrated installation lacks research/catalog.js. It is marked required in the dashboard HTML, causing the loader to hide the entire app. Public catalog URL returns 404. Full HTML browser fixture reproduced the exact error.

## Change
Make the research content catalog optional. Research displays an explicit unavailable notice when absent, retains daily-report controls, and uses the existing session check. Version the research script. No authentication, database or saved-layout changes.

## Verification
Full dashboard fixture changes from failed to ready using actual HTML/assets and mocked API/session responses. Missing-catalog desktop/mobile tests pass for report capture, busy/completion/error states and layout. Existing layout recovery test and JavaScript syntax pass. Public research script SHA256 matches runtime. Actual user authenticated session was not exercised. Generic full-dashboard API mocks produce unrelated data-shape errors.

## Limits
Research catalog content still needs recovery from authoritative source. Full Python suite: 145 passed, 46 subtests passed, then existing missing database-foundation/schema.sql failure. Migrated runtime has no Git history or GitHub remote; workspace origin is the retired Sites deployment, so do not push runtime code there.

## Recovery
Private preimages and hash manifest retained in this workspace. Restore only after comparing subsequent changes.

## Handoff
Login loading blocker fixed in installed runtime; reload the app. Deliverable committed in task workspace and copied to the verified NorthStar Drive folder. No server restart required for these static assets.
