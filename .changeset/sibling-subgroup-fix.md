---
"tabspot": patch
---

fix: prevent entering a previous sibling's subgroup from the next sibling.

A grouper is entered only through its anchor (the focusable immediately preceding it). `findAdjacentGrouperWithEnter` previously also searched backward, which let a focusable that comes *after* a grouper enter that grouper's sublevel — crossing sibling boundaries. Pressing the cross-axis arrow (e.g. ArrowRight) on a sibling that follows a grouper now correctly does nothing.
