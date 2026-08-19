---
"tabspot": patch
---

fix: a virtual move is no longer dropped when its origin row unmounts

`scrollAndActivate` looked up both ends of the move and bailed if either was
missing. In a windowed list the origin row is routinely evicted while the list
scrolls to the target, so the keystroke was silently lost at exactly the point
where the window slides — the failure behind workarounds that pad the item count.

The origin only feeds the event payload, so it is now optional: the move commits
whenever the destination resolves, and the event reports `from: null`.
