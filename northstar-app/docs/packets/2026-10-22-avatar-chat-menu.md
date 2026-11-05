# Avatar and chat menu update — 2026-10-22

## Request
Move avatar and chat controls into hamburger menus across NorthStar and Games. Make the avatar clickable inside User profile.

## Implementation
Shared launcher now inserts User profile and Chat at the top of existing dashboard, Poker and Blackjack menus. Hub and classic games receive a header hamburger menu. The profile avatar opens the existing authenticated picker. Removed both fixed-position launcher controls, preserving inline game chat and account avatar settings. Added menu focus restoration, mobile dismissal and Blackjack stacking fixes. Updated asset version references.

## Runtime
Applied to C:/Users/User/NorthStar/northstar-local and C:/Users/User/NorthStar/games/poker_study/static. Both public hosts returned HTTP 200 with the changed launcher. Static assets are served from disk; no backend code changed.

## Verification
20 browser scenarios passed at desktop (1280) and mobile (390): dashboard toolbar fixture using actual scripts, Games hub and all eight game routes using actual HTML/assets, mocked profile/chat API responses. Verified hidden menu controls, no direct-body floating buttons, avatar selection and synchronization, chat open/close. Focused Python regression checks: 54 passed and 221 subtests passed. JavaScript syntax check passed.

## Limits
Full Python suite stopped at 145 passed, 1 failure and 4 errors because the migrated installation lacks database-foundation/schema.sql. No live user avatar or messages were changed during tests. Full authenticated dashboard was not browser-tested; its actual toolbar scripts were exercised in a fixture. Migrated runtime has no Git metadata or configured remote; runtime commit/tag/push cannot be performed. Source deliverable retained in this task.

## Recovery
Private preimages and SHA256 manifest retained in task workspace. Restore only the requested files after reconciling any subsequent edits; do not overwrite unrelated runtime changes.

## Handoff
Request complete. Existing missing-schema test issue and absent runtime Git history remain separate migration limitations.
