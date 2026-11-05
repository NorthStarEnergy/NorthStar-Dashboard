# Thin crew borders

## Request
Clean, thin, lightly colored group outlines.

## Implementation
Reduced geographic and company borders to consistent 1px, muted colors, and removed heavy station boxes.

## Runtime
Applied field-roster.css and refreshed its asset version.

## Verification
Browser fixture passed at 1600, 1024 and 768px: borders at most 1px, six distinct group colors, all four region filters. Screenshot inspected.

## Limits
No authenticated live verification. Python pytest unavailable via configured python command. Runtime has no Git metadata; source retained in task repository.

## Recovery
Private original files saved in private-preimages/borders.

## Handoff
Refresh dashboard to load the revised stylesheet.
