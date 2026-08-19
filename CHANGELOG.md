# tabspot

## 0.6.0

### Minor Changes

- [#19](https://github.com/JLAcostaEC/tabspot/pull/19) [`e462ea7`](https://github.com/JLAcostaEC/tabspot/commit/e462ea774dba5d969fb3563f20f75af38cf7cd1c) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - feat: additive navigation listeners

  `options.onNavigate` is a single slot, and `tabspot()` is a singleton: a component
  that passed its own listener silently replaced the app's. `subscribe` adds a
  listener instead of replacing one, and returns a detach function:

  ```ts
  const off = instance.subscribe(listEl, (ev) => {
    active = ev.to;
  });
  off();
  ```

  Pass a root as the first argument to receive only that root's events, or omit it
  to receive every root's. `options.onNavigate` keeps working and is called first.
  The event object is shared, so `preventDefault()` from any listener cancels the
  move for all of them.

- [#19](https://github.com/JLAcostaEC/tabspot/pull/19) [`e462ea7`](https://github.com/JLAcostaEC/tabspot/commit/e462ea774dba5d969fb3563f20f75af38cf7cd1c) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - feat: navigation events for a move that runs out of items (`atEdge`)

  A move that clamped used to dispatch nothing, so widgets recomputed the geometry
  Tabspot already knew — "am I on the last row?" — by hand. Now the move dispatches
  with `to: null` and `atEdge: true`, carrying `from`, `fromIndex`, `direction` and
  (on grids) `grid.from`. That's what turns "I ran out of rows" into flipping the
  calendar page, handing the query back, or loading the next slice.

  - `cyclic` movers wrap instead, so they never reach an edge.
  - A cross-axis key is not an edge — it's a key that doesn't apply, and nothing is
    dispatched.
  - The key stays unclaimed by default (the browser still scrolls). Calling
    `preventDefault()` on the edge event claims it.
  - On a virtual root the rendered edge is not the real one: the report is deferred
    to the virtual layer, which fires it only once the real first/last item is
    reached.

  Note for existing `onNavigate` consumers: listeners now also see events with
  `to: null` and `atEdge` set. `to` was already nullable (root-level `escape`
  dispatches with `to: null`), but a listener that dereferences it should check
  `atEdge` first.

### Patch Changes

- [#19](https://github.com/JLAcostaEC/tabspot/pull/19) [`e462ea7`](https://github.com/JLAcostaEC/tabspot/commit/e462ea774dba5d969fb3563f20f75af38cf7cd1c) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - fix: a virtual move is no longer dropped when its origin row unmounts

  `scrollAndActivate` looked up both ends of the move and bailed if either was
  missing. In a windowed list the origin row is routinely evicted while the list
  scrolls to the target, so the keystroke was silently lost at exactly the point
  where the window slides — the failure behind workarounds that pad the item count.

  The origin only feeds the event payload, so it is now optional: the move commits
  whenever the destination resolves, and the event reports `from: null`.

## 0.5.0

### Minor Changes

- [#18](https://github.com/JLAcostaEC/tabspot/pull/18) [`267379d`](https://github.com/JLAcostaEC/tabspot/commit/267379d2e860868e7896f2472b8d15cce60113bf) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - fix: a non-focus root only takes keys from its activation controller

  `activedescendant`, `marked` and `controlled` roots track a cursor that does not
  follow DOM focus, so a keydown anywhere in the root subtree used to drive it.
  An arrow pressed inside a descendant that owns its own arrows — a filter input,
  a slider, a nested widget — moved the cursor on top of the control's own action.

  Keys are now handled only when they come from the root's activation controller:
  the configured `controller` in `activedescendant`, the root element itself in
  `marked` and `controlled`. `focus` roots are unaffected — their cursor is DOM
  focus, which already resolves from the event target.

- [#16](https://github.com/JLAcostaEC/tabspot/pull/16) [`acb7917`](https://github.com/JLAcostaEC/tabspot/commit/acb7917a89cdc0e5b82a36b6e2a48ec38873647d) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - feat: a non-focus root no longer selects its first item on registration

  Registering a root whose mover uses `activedescendant`, `marked` or `controlled`
  activation used to make the first item current straight away, publishing
  `aria-activedescendant` on the controller and marking an option nobody chose.
  The cursor now starts (and stays) empty until the user navigates: the first
  arrow enters the list from outside — a forward key lands on the first item, a
  backward key on the last — and `Home`/`End` do the same where the root manages
  them.

  Adds `clearTabspotActive(root)` to empty the cursor again without unregistering
  the root, so a widget that closes (or whose query changes) can drop the marker
  and the `aria-activedescendant` it published.

## 0.4.0

### Minor Changes

- [#13](https://github.com/JLAcostaEC/tabspot/pull/13) [`9947594`](https://github.com/JLAcostaEC/tabspot/commit/9947594bddf01c93b3c764be2ebaf1c6924036e0) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - feat: add optional `tick` hook on the virtual adapter to await a framework's render flush

### Patch Changes

- [#10](https://github.com/JLAcostaEC/tabspot/pull/10) [`31c456a`](https://github.com/JLAcostaEC/tabspot/commit/31c456a15c7dcc3ff67f9bd81aa4bc9068228f08) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - fix: cyclic wrap on a virtualized list

## 0.3.1

### Patch Changes

- [#8](https://github.com/JLAcostaEC/tabspot/pull/8) [`fe0e503`](https://github.com/JLAcostaEC/tabspot/commit/fe0e5038ebc461ff9da2bbce744ef528bba772a8) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - fix: search for mover/grouper inside mover item

## 0.3.0

### Minor Changes

- [#5](https://github.com/JLAcostaEC/tabspot/pull/5) [`f455c72`](https://github.com/JLAcostaEC/tabspot/commit/f455c72b3037173d7fba70beab4c3941d4cfbeb1) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - feat: replace root `manageEscape` and `manageHomeEnd` with a single `manageSpecialKeys` option.

  `manageSpecialKeys` accepts either a boolean (`true` handles all special keys) or a per-key object toggling `Escape`, `Home`, `End`, `PageUp`, and `PageDown` individually. Keys use the exact `KeyboardEvent.key` strings; omitted keys default to off.

  Migration:

  - `{ manageEscape: true }` → `{ manageSpecialKeys: { Escape: true } }`
  - `{ manageHomeEnd: true }` → `{ manageSpecialKeys: { Home: true, End: true, PageUp: true, PageDown: true } }`
  - both true → `{ manageSpecialKeys: true }`

### Patch Changes

- [#7](https://github.com/JLAcostaEC/tabspot/pull/7) [`f1d8007`](https://github.com/JLAcostaEC/tabspot/commit/f1d80070cc2ffacf3cdc28d953a50a2d717d932a) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - fix: prevent entering a previous sibling's subgroup from the next sibling.

  A grouper is entered only through its anchor (the focusable immediately preceding it). `findAdjacentGrouperWithEnter` previously also searched backward, which let a focusable that comes _after_ a grouper enter that grouper's sublevel — crossing sibling boundaries. Pressing the cross-axis arrow (e.g. ArrowRight) on a sibling that follows a grouper now correctly does nothing.

## 0.2.0

### Minor Changes

- [`0091f14`](https://github.com/JLAcostaEC/tabspot/commit/0091f14f3c222e3e3398785ba9858fc6210f6110) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - fix: unused import

## 0.1.0

### Minor Changes

- [`667f996`](https://github.com/JLAcostaEC/tabspot/commit/667f996a0cc708b9a09de585f885fad2f30d9160) Thanks [@JLAcostaEC](https://github.com/JLAcostaEC)! - Init Commit
