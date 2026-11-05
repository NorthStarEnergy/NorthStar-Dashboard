# Full-window AI chat and model selector

## Request
Fill the window with AI chat and expose a model selector.

## Changes
AI fills the available width and height beneath the fixed status dashboard and beside its navigation rail. The composer stays at the bottom while messages scroll. Model selection is visible in the header, uses enabled models from the existing status endpoint, and retains the existing preference and conversation settings behavior. Removed a stale badge prerequisite that prevented models from loading. Saved asset geometry no longer distorts chat contents. The layout editor is hidden in this fixed chat view.

## Verification
Synthetic browser checks pass for v1, v2 and v3 at 1600x1000 and 1024x768. They verify viewport bounds, composer position, message scrolling, one visible model selector, selected model and compatible reasoning in request payloads, and status failure handling. No real AI request was sent. Required Python regression: 549 passed, 26 failed, 21 skipped, 8 errors, 311 subtests passed; matches the existing baseline. Authenticated Ryan session confirms full-window layout and six configured model choices.

## Runtime
Six static files; no server restart, credential changes or model enablement changes. Existing default navigation, disabled modules and Library remain in place.

## Recovery
Manifest records source hashes. Private preimages are in private-preimages/20261103-ai-window-model. Restore only these files after checking for later changes.

## Delivery
Source, installer and fixture verification in ai-window-work. GitHub credentials remain unavailable from the previous publication attempt.

## Limits
The model list reflects backend-enabled models. The existing phone lineup resets section navigation when crossing its breakpoint; this change targets the desktop dashboard window. Synthetic feed API omissions produce unrelated feed display errors.

Source e503151; tag packet-20261103-ai-window-model.
