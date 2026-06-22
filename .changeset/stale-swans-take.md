---
"tabspot": minor
---

feat: replace root `manageEscape` and `manageHomeEnd` with a single `manageSpecialKeys` option.

`manageSpecialKeys` accepts either a boolean (`true` handles all special keys) or a per-key object toggling `Escape`, `Home`, `End`, `PageUp`, and `PageDown` individually. Keys use the exact `KeyboardEvent.key` strings; omitted keys default to off.

Migration:
- `{ manageEscape: true }` → `{ manageSpecialKeys: { Escape: true } }`
- `{ manageHomeEnd: true }` → `{ manageSpecialKeys: { Home: true, End: true, PageUp: true, PageDown: true } }`
- both true → `{ manageSpecialKeys: true }`