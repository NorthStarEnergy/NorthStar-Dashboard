# Complete module editor

Every registered NorthStar module can now be selected from the module editor itself. The editor covers the full-page and Overview presentations separately while keeping the module name linked between them.

For each presentation, the editor now exposes every editable text label, live-display value, control label, input hint, and image. Edits are applied as presentation overrides after a connected feed renders, so the source feed remains connected. Each individual part has a Restore control. Existing quick label editing remains available for compact operational changes.

The editor retains notes, accent, density, Overview visibility, content blocks, and data-tag bindings. Custom modules also expose section and parent controls so they can be moved or nested without rebuilding them.

Validation: the module workspace browser scenarios passed with module selection, editable-text save/restore, custom placement, content blocks, full/compact draft retention, resize, navigation and reload persistence. The Overview browser scenarios passed, including a compact dispatch label persisting through a feed update. Persistent-status browser scenarios passed earlier in this packet. Full Python validation and the clean release verification are recorded in the commit and release artifact.
