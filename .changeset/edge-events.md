---
"tabspot": minor
---

feat: navigation events for a move that runs out of items (`atEdge`)

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
