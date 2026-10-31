# What's new in Dotted Line

What changed in each version, in plain words. The newest is at the top. Chrome updates
Dotted Line by itself a few hours after a version is published.

## Not released yet

- **Auto place on a document you uploaded in Real Signature.** Upload a PDF to Send
  One-time Document, open it from your Draft tab, and the panel places its signature,
  initials and date blocks from its printed labels, as it does for WEBForms forms.
  - New uploads from the last week are listed in the panel, each with Set up: it fills
    the deal, signers, document name and email subject the same way as from WEBForms.
  - Anything you already chose in Real Signature stays: a deal picked, a name given, a
    subject typed, blocks already placed.
  - Packets too: on a packet's Edit page, Auto place this packet places blocks on each of
    its documents for that document's own signers.
  - When a form has a client signature line and the document has both buyers and
    sellers, the panel asks whose line it is.
  - The Disclosure of Remuneration's one client line gets both clients side by side.
- **A clearer panel.** Each screen has a heading for its one job and the choices in the
  order you make them; forms and documents are listed as rows; the pressed button shows
  what it's doing; results and errors appear under it. The panel uses each site's own
  words: forms and the Basket for WEBForms, a document or packet for Real Signature.
- Error reports (only if you said yes) cover Auto place on an uploaded document too.
- **Auto place: more BC forms.** The Contract of Purchase and Sale's and Subject Removal's
  page-foot "BUYER'S INITIALS" and "SELLER'S INITIALS" boxes, Subject Removal's three buyer
  and three seller signature lines (printed as a picture, so found by where they sit), and the Disclosure of
  Multiple Offers Presented (sellers, the designated agent, and "Confirmed and signed
  this ___ Day of").
- **Auto place: Alberta's commercial lease forms.** On a lease, the tenant signs where a
  buyer would and the landlord where a seller would: the Commercial Offer to Lease (each
  side's signing officers and its date and time), its Addendum, the Commercial Exclusive
  Tenant Representation Agreement, and the commercial Agency Relationships guide. A form
  is read as a lease only when it says tenant and landlord more than buyer and seller, so
  a purchase contract that mentions tenants is unchanged.
- **Fix:** with a deal picked, the number of buyers or sellers is the deal's own when the
  WEBForms forms don't name them (commercial forms, for one), not always at least 2.
- **Fix:** on a numbered street ("120 9 Ave SE") the street's number counted as a house
  number, so another deal on the same street tied with the right one and no deal was
  picked. "9th Ave" and "9 Ave" now match too.
- **Fix:** a client entered in reZEN as a company (a company name, no first or last name)
  made Real Signature refuse the whole document ("name must not be blank"). The company's
  name is now the signer's name; a client with no name at all is left off and named in
  the panel, like one with no email.
- **Fix:** Auto place put Alberta's Notice (waiver or satisfaction of conditions) on the
  sellers; its "Buyer/Seller Signature" lines now go to your own clients, whichever side.
- **Fix:** Check my setup now says "yes (own corporation)" when WEBForms is signed in as
  your personal real estate corporation, as the panel already did, instead of "no".
- **Fix:** error reports (only if you said yes) now cover Import templates in Settings:
  when Real Signature refuses a template, its answer is reported, never your file or its
  name.

## 0.2.0 — 2026-10-29

- **Auto place: blocks placed for you, with no template.** For a form you have no template
  for, Dotted Line reads the form's printed labels ("Signature of Seller", "Buyer's
  Initials", "Signed and dated … on") and places signature, initials, date and time blocks
  on them. Alberta, British Columbia, Manitoba, Ontario and Saskatchewan forms so far, and
  the Consumer Relationships Guide. Names are left for you to type in WEBForms.
  - It's the choice when no template is remembered or suggested; "No template" is still
    in the list.
  - Switch a form from your usual template to Auto place and that's remembered too.
  - Where the form has a separate time blank, the time and the date are separate blocks.
    Every placed block is required, so a signer can't skip a date or time; delete any you
    don't want in Real Signature.
  - Signature and date boxes stop short of printed text just above them.
  - "Add the agent as a signer" is ticked when a form placed this way has an agent line.
- **No deal when nothing comes close.** When no reZEN deal or Buyer Record comes anywhere
  near the form's address or buyers (usually a form signed before there's a deal), No deal
  is picked for you, and one click goes ahead. When several deals could match, you still
  choose.
- **See what one click chose.** After a one-click draft, click the Dotted Line icon on it:
  the deal (or No deal, and why), each form's template or Auto place, and whether the agent
  signs. When one click chose for you, the icon shows a small amber dot until you've looked
  or moved past the first step.
- **Tidier lists.** The reZEN deal list shows the close matches first, then No deal, then
  your deals, listings and Buyer Records in groups of their own, in address or name order.
  A small gap in the template list separates your templates from the two other choices,
  and long names wrap instead of running off the panel.
- **A new icon.**
- With "Start as soon as I click the Dotted Line icon" on, the popup shows what it's doing
  instead of a grey Prepare button and a title you could no longer change; both come back
  if something stops it.
- Check my setup shows two more timings: reading the forms from WEBForms, and reading
  their labels.
- Using the Real Signature app? Finish the draft in the browser tab first (see the README).
- **Error reports** (only if you said yes) now also say when Auto place found nothing to
  place on a form, and which form type it was (WEBForms' code for the blank form, like
  AREA0287), so we know which forms to add next. They also tell No deal picked for you from
  No deal you chose, and count drafts that used Auto place.
  [What a report can hold](PRIVACY.md#error-reports-if-you-say-yes).

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
