# Standalone access to existing tool workspaces

## Request
Password-only access independent of NorthStar sign-in, using existing SCADA Bench and outage records, plus main-menu links opening separate pages.

## Changes
A dedicated /public-outage-api/tools/ gateway issues 12-hour tool-scoped guest sessions. Password SHA-256 configuration stays in private runtime data or NORTHSTAR_TOOL_PASSWORD_SHA256. Existing checkout/review rules remain. Guest writes have request audit entries; outage record actions name ToolGuest identities. Worker and machine-management endpoints are not shared.

## Verification
647 Python tests passed (21 skipped; 347 subtests), 77 JavaScript checks, five isolated gateway tests, eight Worker tests, and end-to-end browser login/logout with synthetic records. Live browser checks confirmed both existing workspaces load and logout works; no production records were edited.

## Activation
Public Site version 38, source b784d13556e084bba9bd868e52ebbede6e6ca3c4. URLs: https://northstarenergy.ca/scada-workbench/ and https://northstarenergy.ca/outage-manager/. NorthStar backend activated using its existing scheduled task.

## Runtime repair
SCADA Manager referenced a retired Codex Node version. Updated only executable paths and scheduled task action; kept desired states, dataRoot and outputRoots. Backup: SCADA/_tool-access-backup-20261118. Manager reports controller, bridge and fleet running.

## Recovery
Private preimages are under outputs/change-coordinator/preimages/20261118-tool-password-01a1ec95. Restore code through the managed restart and use Site version 37 if rolling back; preserve current operational data and tool session store.

## Source and boundaries
NorthStar source changes are separate from existing dirty dashboard/game work. Original NorthStar, check-in and legacy visitor authentication remain scoped; no NorthStar account or service token is sent to the public browser.
