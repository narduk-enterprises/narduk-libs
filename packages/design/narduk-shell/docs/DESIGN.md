# Design rules for Narduk web apps

Rules every Narduk web app follows, each with the shared component that draws
it. A rule is here once Logan has made the call; an app that needs an exception
names it in its own docs with the reason.

## Form actions

Logan, 2026-11-16.

> A form's or dialog's actions sit in one row at the bottom, right-aligned to
> the form's edge: the primary rightmost and filled, Cancel and other
> secondaries to its left and quiet, a destructive action alone at the far left.
> Below 640 px the row is full width and stacked, primary on top. Enter submits
> the primary; Esc cancels a dialog.

The component is `NeFormActions` (README, "NeFormActions"). `NeForm`'s save bar
and `NeConfirmDialog`'s footer are built on it, so a form made from those
already follows the rule.

How to apply it:

- **Order.** Write Cancel first and the primary last. The row puts the last
  button rightmost on a desk and on top on a phone.
- **One primary.** One filled button per row. Cancel and other secondaries are
  quiet: `color="neutral"` with `variant="ghost"` or `variant="outline"`, one
  look per app.
- **Destructive.** A delete beside Save goes in the `lead` slot, alone at the
  far left, away from the primary. A destructive act that is the dialog's own
  answer ("Delete runner?" → Delete) is the primary: rightmost, `color="error"`.
- **Enter.** The primary is `type="submit"` inside the `<form>`, or carries
  `form="id"` when the row sits in a dialog's footer outside the form element.
  Cancel is `type="button"`.
- **Esc.** `UModal` closes on Esc; do not turn it off, except while a save is in
  flight.

Not covered, because they are their own patterns: a one-field row (a search or a
code with its button on the same line), a toolbar or filter bar above a table, a
card's own action bar, and the phone's fixed bottom call to action
(`NeStickyActionBar`).

What goes wrong without it, from the 2026-11-16 audits of PACC Trac, MyBoat and
Stonx: a Save that floats at the left under its fields, the primary written
before Cancel, a dialog where Enter does nothing because its fields are not in a
form, Cancel drawn two ways in one app, and rows that do not stack on a phone.
