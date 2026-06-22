# tabspot

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
