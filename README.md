<p align="center">
	<picture>
  		<source media="(prefers-color-scheme: dark)" srcset="https://github.com/JLAcostaEC/tabspot/blob/main/assets/logo-dark.jpg?raw=true" height="260" />
  		<img alt="TabSpot Logo" src="https://github.com/JLAcostaEC/tabspot/blob/main/assets/logo-white.jpg?raw=true" height="260" />
	</picture>
</p>

# TabSpot

Keyboard navigation engine for hierarchical & grid interfaces.

Declarative arrow-key / Home-End / PageUp-Down / Escape routing for any DOM tree. Configure roots and sub-groups via a single JSON attribute and TabSpot wires up focus moves, grouper enter/exit transitions, roving tabindex, grid navigation, RTL, and virtual lists — without inventing custom focus state, without fighting the browser, and without dependencies.

- Single attribute per element: `data-tabspot`.
- **Implicit singleton**: `tabspot()` is idempotent; one engine per page/app.
- **Mover**: Easy navigation within a level. 
- **Grouper**: Sublevel navigation with enter/exit directions.
- **Grid movers** (`layout: "grid"`): 2-D matrix navigation with pluggable row detection.
- **Roving tabindex** by default: `Tab` enters/leaves the widget as one stop; arrows navigate within.
- **Activation modes**: real focus, `aria-activedescendant`, a `mark` (class/attribute, default `data-active`), or fully controlled.
- **Virtualization**: navigate windowed lists/grids out of the box via a small adapter.
- DOM-driven: a `MutationObserver` marks roots dirty and rebuilds lazily on the next keystroke / focus change.
- Zero runtime dependencies. Tree-shakeable. SSR-safe helper for pre-render.

## Install

### NPM:
```sh
npm install -D tabspot
```


### PNPM:
```sh
pnpm add -D tabspot
```
>[!IMPORTANT]
> Runtime needs a modern browser with `MutationObserver`, `WeakRef`, `WeakMap`, and `Element.checkVisibility`.

## Quick start

```ts
import { tabspot, setTabspotAttributes } from "tabspot";

tabspot({ debug: "basic" }); // start the singleton (once, in a client-side effect)

const nav = document.querySelector<HTMLElement>("#main-nav")!;
setTabspotAttributes({
  element: nav,
  config: {
    root: { manageSpecialKeys: true },
    mover: { axis: "vertical", cyclic: true },
  },
});
```

For SSR use `getTabspotAttributes`, it returns the attributes to be rendered on the server.

```tsx
import { getTabspotAttributes } from "tabspot";

const attrs = getTabspotAttributes({
  root: { manageSpecialKeys: true },
  mover: { axis: "vertical", cyclic: true },
});

return <nav id="main-nav" {...attrs}>
  <a href="/home">Home</a>
  <a href="/about">About</a>
  <a href="/contact">Contact</a>
</nav>;
```

Or declare a root entirely in HTML — Tabspot picks it up on boot:

```html
<ul data-tabspot='{"root":{},"mover":{"axis":"horizontal","cyclic":true}}'>
  <li tabindex="0">One</li>
  <li tabindex="-1">Two</li>
  <li tabindex="-1">Three</li>
</ul>
```

## Configuration shape

Every element configured with Tabspot carries a single `data-tabspot` attribute whose value is strict JSON with up to four optional sections:

```ts
interface TabspotNodeOptions {
  root?: {
    // true = handle all; or toggle each key. Esc exits; the rest jump.
    manageSpecialKeys?: boolean | Partial<Record<RootSpecialKey, boolean>>;
    //   RootSpecialKey = "Escape" | "Home" | "End" | "PageUp" | "PageDown"
    rtl?: "auto" | "ltr" | "rtl";
    debug?: "basic" | "full";
  };
  // Mover is a discriminated union on `layout`:
  mover?:
    | { layout?: "linear"; axis: "horizontal" | "vertical";
    | { layout: "grid"; flow?: "contained" | "linear";
        rows?: GridRowStrategy; pageSize?: number; };
  grouper?: { enterDirection?: Dir; exitDirection?: Dir; enterExitOnLast?: boolean };
  observer?: { name: string };
}

// common mover fields (both layouts):
//   cyclic?: boolean
//   ignoreKeys?: readonly ManagedKey[]   // Tab, ArrowLeft/Right/Up/Down, Home, End, PageUp, PageDown
//   visibilityAware?: "Invisible" | "Visible"
//   items?: string                       // CSS selector: which descendants are navigable
//   activation?: Activation              // how the active item is expressed (see below)

type GridRowStrategy =
  | { by: "parent" }  // default: focusables sharing a parent element
  | { by: "columns"; count: number } // chunk the flat item list into rows of N
  | { by: "selector"; row: string } // el.closest(row) defines the row (e.g. "tr")
  | { by: "geometry"; tolerance?: number };// cluster by getBoundingClientRect().top

type ActiveMark = { class: string } | { attribute: string }; // toggled on the active item
type Activation =
  | "focus" | "marked" | "controlled"
  | { mode: "focus"; roving?: boolean }
  | { mode: "activedescendant"; controller: string; mark?: ActiveMark }
  | { mode: "marked"; mark?: ActiveMark } // default mark: { attribute: "data-active" }
  | { mode: "controlled" };
```

- `root` and `grouper` cannot coexist on the same element.
- Unknown keys, wrong enums, non-boolean booleans, and inapplicable fields (e.g. `flow` on a linear mover) are rejected (logged via `console.error`).
- A linear mover **requires** `axis`. A grid mover is marked by `layout: "grid"`.

### Levels and transitions

- **Mover**: its children stay at the parent's level. A linear Mover carries the axis + cyclic behavior for in-axis moves.
- **Grouper** opens a new level (`level + 1`). Enter via `grouper.enterDirection` from a sibling, or any cross-axis arrow when the grouper is implicit. Exit via `grouper.exitDirection` (gated by first/last + `enterExitOnLast`) or `Escape` (if `manageSpecialKeys.Escape`).
- A focusable that declares its own `mover` synthesizes an `implicit grouper` underneath.

## Grid movers (`layout: "grid"`)

A grid mover navigates its items as a 2-D matrix: **both** axes move. Rows are detected per `rows` (default `{ by: "parent" }`); the column index is the position within the row.

```html
<table data-tabspot='{"root":{},"mover":{"layout":"grid"}}'>
  <thead><tr><th tabindex="0">A1</th><th tabindex="-1">A2</th><th tabindex="-1">A3</th></tr></thead>
  <tbody>
    <tr><td tabindex="-1">B1</td><td tabindex="-1">B2</td><td tabindex="-1">B3</td></tr>
    <tr><td tabindex="-1">C1</td><td tabindex="-1">C2</td><td tabindex="-1">C3</td></tr>
  </tbody>
</table>
```

- **`flow: "contained"`** (default) — `ArrowLeft|Right` move within the current row; `ArrowUp|Down` within the column. Clamps at every edge.
- **`flow: "linear"`** — vertical is identical, but `ArrowLeft|Right` traverse the whole row-major sequence (end of a row continues into the next), clamping only at the global first/last cell.
- `cyclic: true` wraps within the row/column (or around the whole sequence for `flow: "linear"`).
- **Keys** (gated per-key by `manageSpecialKeys`): `Home`/`End` → start/end of the current row; `Ctrl+Home`/`Ctrl+End` → first/last cell of the grid; `PageUp`/`PageDown` → ±`pageSize` rows (default 5).
- Row strategies handle markup `parent`-grouping can't: `{by:"selector",row:"tr"}` for `<td><button>` cells, `{by:"columns",count}` for CSS grids without row wrappers, `{by:"geometry"}` for flex-wrap layouts.

## `items` — declaring the navigable set

When a mover declares `items`, membership is the CSS selector (not focusable detection), and Tabspot **grants focusability** by managing `tabindex` on matching elements. This makes plain `<div onclick>` cells keyboard-navigable without authoring any `tabindex`:

```html
<div class="grid" data-tabspot='{"root":{},"mover":{"layout":"grid","items":".cell"}}'>
  <div class="cell" onclick="…">A</div>
  <div class="cell" onclick="…">B</div>
</div>
<!-- Tabspot sets one .cell to tabindex="0" and the rest to "-1". -->
```

## Roving tabindex

By default (`activation: "focus"`), Tabspot manages roving tabindex: exactly **one** item per root is the tab stop (`tabindex="0"`), the rest are `tabindex="-1"`. So `Tab` treats the widget as a single stop and arrows navigate within; the tab stop follows focus (keyboard and mouse).

- Recommended authoring: first item `tabindex="0"`, the rest `tabindex="-1"` (reachable without JS, no flash). Tabspot normalizes any authoring.
- Under roving, `tabindex="-1"` counts as a navigable item (it's how Tabspot demotes inactive ones).
- Tabspot restores the original `tabindex` on `destroy()` or when the root is removed from the DOM.
- Disable with `activation: { mode: "focus", roving: false }`.

## Activation modes (mover without moving focus)

`mover.activation` decides how the "active" item is expressed — orthogonal to `layout`:

| `activation` | On move | DOM focus | Needs | Use |
| --- | --- | --- | --- | --- |
| `"focus"` (default) | `.focus()` + roving tabindex | moves | — | grids, menus, lists |
| `"activedescendant"` | sets `aria-activedescendant` on the controller | stays on the controller | `controller` + `items` | combobox / input-driven listbox |
| `"marked"` | toggles `mark` (class or attribute, default `data-active`) on the active item | does not move | `items` | selection lists, custom highlight |
| `"controlled"` | nothing — only emits `onNavigate` | does not move | `items` | framework-owned state, virtual lists |

```html
<input id="cb" role="combobox" aria-controls="lb" aria-expanded="true" />
<ul id="lb" role="listbox"
    data-tabspot='{"root":{},"mover":{"axis":"vertical","items":"[role=option]",
      "activation":{"mode":"activedescendant","controller":"#cb","mark":{"attribute":"aria-selected"}}}}'>
  <li role="option" id="o1">Apple</li>
  <li role="option" id="o2">Banana</li>
</ul>
<!-- Arrows fire on the input; Tabspot moves aria-activedescendant on #cb and (with
     mark) aria-selected on the active option; focus stays in #cb. -->
```

`mark` (in `marked` and optionally in `activedescendant`) is `{ class: "…" }` or
`{ attribute: "…" }` — toggled on the active item and cleared from the previous one.
`activedescendant` only sets `aria-activedescendant` on the controller by default;
add **`mark`** to also mark the active option itself (the APG combobox pattern, and a
CSS hook like `[role=option][aria-selected="true"]` or `.option.is-active`). For ARIA,
use `aria-selected` (idiomatic for listbox/combobox), **not** `aria-current` (which is
for "current within a set" like pagination).

> Tabspot only writes the navigation-coupled state above (`tabindex`, `aria-activedescendant`, the active marker). Static roles (`role="grid"`, `role="listbox"`, …) and widget state remain the author's responsibility.

### Clearing the cursor

A non-`focus` root has **no active item** when it registers: nothing is marked and
no `aria-activedescendant` is published until the user navigates.

Call `clearTabspotActive(root)` to go back to an empty cursor without unregistering
the root — e.g. when the popup closes or the query changes and no suggestion should
read as chosen. It clears the mark and the controller's `aria-activedescendant`.

## Virtualization

Tabspot navigates the DOM, not your data model. For windowed lists/grids, expose the real index declaratively and the scroll imperatively:

```ts
import { tabspotVirtual } from "tabspot";

// in a client effect, once the list is mounted:
const detach = tabspotVirtual(listEl, {
  scrollToIndex: (index) => rowVirtualizer.scrollToIndex(index), // sync or async
  count: () => total, // or omit and use aria-setsize/aria-rowcount
  tick: () => nextTick(), // optional: Vue nextTick / Svelte tick / etc.
});
// cleanup: detach()
```

- Each rendered item carries its real index via `data-index` (preferred) or `aria-posinset` / `aria-rowindex`; the total via `aria-setsize` / `aria-rowcount` or `adapter.count()`.
- When an arrow clamps at the rendered edge, Tabspot calls `scrollToIndex(target)`, waits for that index to render, then activates it (with coalescing for held keys).
- By default the render wait uses a `MutationObserver` bounded by a ~1s timeout. Provide `tick` (a `() => Promise<void>` such as Vue's `nextTick` or Svelte's `tick`) and Tabspot awaits your framework's render flush instead — no timeout in the happy path. If the row still isn't rendered when `tick` resolves, it falls back to the observer.
- For grids, rows are virtualized by `data-index` on the `<tr>` and the column is preserved via `data-colindex` on cells.
- Use `activation: "activedescendant"` or `"controlled"` for virtual lists — `"focus"` is fragile because a focused row can unmount on scroll.
- `tabspotVirtual` is keyed by element (no instance argument) and tree-shakeable.

## Public API

| Symbol | Purpose |
| --- | --- |
| `tabspot(options?)` | Start/return the singleton (browser-only). `options`: `debug`, `onNavigate`, `logger`. |
| `tabspotObserver(instance)` | Pending-target observer: pre-register configs by CSS selector. |
| `tabspotVirtual(el, adapter)` | Register a virtualization adapter for a root. Returns a detach fn. |
| `setTabspotAttributes(args)` | Validate + write `data-tabspot` + register/unregister. Returns a `SetAttributesResult`. |
| `setTabspotAttributesBatch(items)` | Apply many `setTabspotAttributes` at once; a result per entry. |
| `unsetTabspotSection(el, section)` | Remove one section (merge can't clear a section). |
| `getTabspotAttributes(config)` | Pure helper — returns `{ "data-tabspot": "…" }` for SSR. |
| `clearTabspotActive(el)` | Empty a non-`focus` root's cursor (clears the mark + `aria-activedescendant`). |

### `setTabspotAttributes` result

```ts
const res = setTabspotAttributes({ element, config });
if (res.ok) {
  // res.instance is the engine instance (or null if no engine yet)
} else {
  // res.reason is "invalid" | "nested-root"; res.message explains why
}
```

### `TabspotInstance`

```ts
instance.update({ debug: "full", onNavigate(ev) { … } });
instance.rebuild();       // force-rebuild every registered root
instance.rebuild(rootEl); // force-rebuild a specific root
instance.subscribe(fn);        // additive navigation listener → detach fn
instance.subscribe(rootEl, fn) // …scoped to one root
instance.destroy();       // stop the engine; restore managed tabindex; leave data-tabspot intact
```

### `onNavigate`

Fires for every move (arrow / home / end / pageup / pagedown / escape). Call `event.preventDefault()` to cancel — Tabspot swallows the key but does **not** move/activate.

```ts
tabspot({
  onNavigate(ev) {
    // ev: { direction, key, from, to, root, level, fromIndex?, toIndex?, grid?,
    //       atRenderedBoundary?, atEdge? }
    if (ev.direction === "escape") ev.preventDefault();
  },
});
```

### `instance.subscribe` — additive listeners

`options.onNavigate` is a **single slot**: the next `tabspot()` call overwrites it, so a component
that sets it steals the app's listener. `subscribe` is additive instead — everyone who signs up is
called — and returns a detach function. Pass a root to hear only that root:

```ts
const off = instance.subscribe(listEl, (ev) => {
  active = ev.to;
});
// on unmount:
off();

instance.subscribe((ev) => …); // every root
```

The event object is shared, so `preventDefault()` from any listener cancels the move for all.

### Edge events (`atEdge`)

A move that runs out of items dispatches too, with `to: null` and `atEdge: true`. "I ran out of
rows" is domain information the engine can't act on but the widget can:

```ts
instance.subscribe(gridEl, (ev) => {
  if (!ev.atEdge) return;
  if (ev.direction === "down") { nextPage(); ev.preventDefault(); }
});
```

- `cyclic` movers wrap instead, so they never reach an edge.
- A cross-axis key is **not** an edge — it's a key that doesn't apply, and nothing is dispatched.
- By default the key stays unclaimed (the browser still scrolls); `preventDefault()` claims it.
- On a virtual root the *rendered* edge isn't the real one: `atEdge` fires only once the real
  first/last item is reached.

### Custom log sink

```ts
tabspot({ logger: (level, args) => myLogger[level](...args) }); // replaces console output
```

### Pre-render / SSR

```ts
const props = getTabspotAttributes({ root: {}, mover: { axis: "vertical", cyclic: true } });
// -> { "data-tabspot": "{\"root\":{},\"mover\":{\"axis\":\"vertical\",\"cyclic\":true}}" }
```

Spread `props` onto your element during render; the engine picks the root up when it boots in the browser.

### Pending observer (`tabspotObserver`)

Use `tabspotObserver` to register configs by CSS selector, before the target elements exist. The observer waits for matching elements to appear in the DOM and registers them automatically.

```ts
const obs = tabspotObserver(instance);

obs.observe({ 
  name: "settings-panel", 
  selector: "[data-view='settings'] nav",
  config: { root: {}, mover: { axis: "vertical" } } 
});

obs.disconnect("settings-panel");
```

If the selector doesn't match yet, the registration stays pending until a matching element is added.

## Development

```sh
pnpm install
pnpm dev        # build watch
pnpm check      # typecheck + lint + format + browser tests (Playwright/Chromium)
pnpm build      # produce dist/
```

## License

MIT © Jorge Acosta
