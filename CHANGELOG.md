# What's new in Dotted Line

What changed in each version, in plain words. The newest is at the top. Chrome updates
Dotted Line by itself a few hours after a version is published.

## Not released yet

- **Auto place: blocks placed for you, with no template.** For a form you have no template
  for, Dotted Line reads the form's printed labels ("Signature of Seller", "Buyer's
  Initials", "Signed and dated … on") and places signature, initials, date and time blocks
  on them. Alberta, Manitoba and Ontario forms so far, and the Consumer Relationships Guide.
  Names are left for you to type in WEBForms. It's the default when no template is
  remembered or suggested; "No template" is still in the list.
- Where the form has a separate time blank, the time and the date are separate blocks.
  Every placed block is required, so a signer can't skip a date or time.
- "Add the agent as a signer" is ticked when a form placed this way has an agent line.
- A small gap in the template list separates your templates from the two other choices.
- The reZEN deal list shows the close matches first, then No deal, then your deals,
  listings and Buyer Records in groups of their own, each in address or name order.
- When no reZEN deal or Buyer Record comes anywhere near the form's address or buyers
  (usually a form signed before there's a deal), No deal is picked for you, and one click
  goes ahead. When several deals could match, you still choose.
- **After a one-click draft, click the Dotted Line icon to see what it chose:** the deal
  (or No deal, and why), each form's template or blocks placed from its labels, and
  whether the agent signs. When one click chose for you, the icon shows a small amber dot
  until you've looked or moved past the first step.
- With "Start as soon as I click the Dotted Line icon" on, the popup shows what it's doing
  instead of a grey Prepare button; the button comes back if something stops it.
- Check my setup shows two more timings: reading the forms from WEBForms, and reading
  their labels.
- Using the Real Signature app? Finish the draft in the browser tab first (see the README).

## 0.1.2 — 2026-10-28

- **Error reports, only if you say yes.** The first time you open Dotted Line it asks
  whether it may send the Deal Dates team a short report when a draft fails, and a daily
  count of drafts that worked. A report never holds your forms, or any name, email,
  address, deal or template ([everything a report can hold](PRIVACY.md#error-reports-if-you-say-yes)).
  You can change your answer any time in Settings. If you say no, you can still send a
  single report yourself with the button under an error.
- The button sits inside the red error box, so it's clear which error it's about.
- The same error happening again within a few minutes is sent once, and the panel says so.
- **Two copies of the same form** (say, one for each signer) now go into the draft together.
  They used to be refused until you renamed one.
- **Finish draft stays grey until every form has a template** (or No template), with a
  note saying so, instead of telling you only after you press it.

## 0.1.1 — 2026-10-27

- **You see the signers' email subject before the draft is made.** It's shown under the
  title in the Real Signature panel, with a count, and follows the title until you edit it.
  Real Signature allows 70 characters. A longer subject used to be cut short without telling
  you; now Finish draft waits until you shorten it, and one click hands over to the panel
  instead of sending a cut-down subject.
- **Your own corporation isn't a warning any more.** If your WEBForms account is in your
  personal real estate corporation's name, Dotted Line now says so as a note instead of
  warning "different people", and one-click drafts are no longer held up by it.
- **Fix:** when a transaction coordinator switched "Acting as" in Real Signature, the
  panel could miss the switch and keep showing the previous agent's deals.
- **Fix:** Check my setup now shows the error code from each site instead of just "error".

## 0.1.0 — 2026-10-16

First release in the Chrome Web Store (unlisted).

- Tick forms in CREA WEBForms, or use the Basket, and Dotted Line brings them into Real
  Signature as a draft on the matching reZEN deal, with the signers filled in and the
  signature, initials and date blocks placed from your templates.
- One-click drafts when nothing needs your choice; otherwise the Real Signature panel asks.
- Several forms become a packet.
- Import templates from a template file, in Settings.
- Check my setup, in Settings, for troubleshooting.
- Draft only: you review it and send it from Real Signature yourself.
