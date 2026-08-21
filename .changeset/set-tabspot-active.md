---
"tabspot": minor
---

feat: new `setTabspotActive` cursor setter for non-`focus` roots

Move the cursor of an `activedescendant` / `marked` / `controlled` root onto an item
programmatically, as if the user had navigated there. The navigation event is dispatched with
the new `direction: "programmatic"` (and an empty `key`), and a listener can still cancel it
with `preventDefault()`.

```ts
const res = setTabspotActive(optionEl, { nearest: true });
if (res.ok) {
  // res.root / res.from / res.to; res.moved is false when the cursor was already there
} else {
  console.warn(res.reason, res.message); // never throws
}
```

You pass an **item**, not a root: Tabspot derives the root from it (roots cannot nest, so an item
belongs to exactly one). There is no ambient "current root" — on a page of 200 comboboxes you
target one by querying inside its own list, and `res.root` reports which one the move landed in.

The counterpart to `clearTabspotActive`, and the piece that lets a consumer finish a combobox:
Tabspot owns navigation, the app owns filtering and the value, and this is the handoff between
them — "I filtered, put the cursor here". Tabspot still never reads or writes the controller's
value.

It exists because the cursor of a non-`focus` root has no native setter. A `focus` root already
has one — `el.focus()`, which the engine notices and follows — so this refuses there with
`reason: "focus-mode"`.

Details:

- Refuses (never throws) with a typed `reason`: `"reentrant"`, `"no-root"`, `"focus-mode"`,
  `"not-an-item"`, `"skipped"`, `"cancelled"`.
- `nearest: true` lands on the closest landable item at the requested item's level when the
  requested one is matched by `mover.skip` — forward first, then backward, never crossing
  grouper levels.
- `direction` can be overridden when the move stands in for a keyed one.
- Idempotent: called with the item the cursor is already on, it reports `ok` with
  `moved: false` and dispatches nothing.
- Recompiles a dirty root first, so an element captured before a re-render still resolves.
- Refused while a navigation event is being dispatched, because a cursor write from inside a
  listener re-enters the dispatch and loops. To redirect a move, cancel it with
  `preventDefault()` and call this afterwards — or declare the rule with `mover.skip`.

`TabspotNavigationEvent["direction"]` gains `"programmatic"`. A `switch` over `direction` that
was exhaustive now needs that case.
