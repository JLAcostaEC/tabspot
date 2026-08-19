---
"tabspot": minor
---

feat: a non-focus root no longer selects its first item on registration

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
