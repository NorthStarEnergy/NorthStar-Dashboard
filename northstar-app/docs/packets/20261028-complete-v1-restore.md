# Complete pre-v3 v1 restoration

## Request
Restore the complete v1 state immediately before v3 work began on October 27. Identify and isolate later edits rather than incorporating them into the restored view.

## Changes
Reconstructed the original shell and original changed controllers from pre-v3 source. All 129 directly referenced local JavaScript and CSS dependencies now have independent v1 filenames. Restored v1 uses an isolated layout namespace and per-account checkpoint, seeded from the pre-v3 shared baseline. Later personal layouts and the old shared keys remain untouched. The build-selection bridge remains available.

## Verification
Browser fixture checks pass for the original worker heading and controls, 18 station tiles, the overview market graph, navigation across eight sections, reloads and v1/v3 switching. Archived pre-v3 geometry matches at 1600, 1264 and 768 pixels. A deliberately conflicting later account checkpoint cannot hide restored modules; saving v1 leaves it unchanged. Zero JavaScript errors. Installed files match all 130 manifest hashes. Isolated backend regression suite: 4 failed, 538 passed, 21 skipped, 8 errors, 347 subtests passed in 143.92s (0:02:23). The four failures and eight errors are the known missing schema/legacy-source and Research expectation failures; no backend source was changed by this packet. Unauthenticated live static probes correctly return 404; no authenticated operational verification is claimed.

## Runtime
Installed at C:/Users/User/NorthStar/northstar-local. Refresh and select v1, or open northstar-v1.html?buildView=v1. Static presentation changes require no server restart. Backends, worker app, operational records and v3 source remain unchanged.

## Recovery
The prior shell is privately saved under private-preimages/20261028-complete-v1-restore. Reviewable later UI sources are in later-edits/. Restore the prior shell under the coordinator lock to reverse the activation; unused v1-baseline files can remain. Do not clear browser storage.

## Delivery
Source commit/tag and verified archive delivery are recorded after verification. There is no GitHub remote configured; the existing Sites remote is unrelated to this runtime and was not used for publication.

## Limits
UI checks use fixture operational APIs, not real worker actions. This restores the confirmed source baseline and its captured shared layout, not an unavailable historical per-browser screenshot. New v1 layout saves are local to that account/browser to prevent another build from changing them. Later check-in protocol integration is preserved separately for review.
