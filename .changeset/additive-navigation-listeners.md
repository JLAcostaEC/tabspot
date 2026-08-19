---
"tabspot": minor
---

feat: additive navigation listeners

`options.onNavigate` is a single slot, and `tabspot()` is a singleton: a component
that passed its own listener silently replaced the app's. `subscribe` adds a
listener instead of replacing one, and returns a detach function:

```ts
const off = instance.subscribe(listEl, (ev) => { active = ev.to; });
off();
```

Pass a root as the first argument to receive only that root's events, or omit it
to receive every root's. `options.onNavigate` keeps working and is called first.
The event object is shared, so `preventDefault()` from any listener cancels the
move for all of them.
