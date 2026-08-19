---
"tabspot": minor
---

fix: a non-focus root only takes keys from its activation controller

`activedescendant`, `marked` and `controlled` roots track a cursor that does not
follow DOM focus, so a keydown anywhere in the root subtree used to drive it.
An arrow pressed inside a descendant that owns its own arrows — a filter input,
a slider, a nested widget — moved the cursor on top of the control's own action.

Keys are now handled only when they come from the root's activation controller:
the configured `controller` in `activedescendant`, the root element itself in
`marked` and `controlled`. `focus` roots are unaffected — their cursor is DOM
focus, which already resolves from the event target.
