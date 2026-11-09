# What's new in Dotted Line

What changed in each version, in plain words. The newest is at the top. Chrome updates
Dotted Line by itself a few hours after a version is published.

## Not released yet

- **Signing in partway through no longer shows an error.** If Real Signature sent you
  to sign in just as one click was starting, the panel showed a red "message channel
  closed" error. Now your forms wait while you sign in, the same as any other sign-in.
- **Alberta's Customer Acknowledgement now gets your date.** Auto place put your
  signature on the brokerage representative's line but no date. Now the "Signed and dated
  on" line is your date, the way the Fee Disclosure has it. The customers' lines are still
  left for you to place, because the form doesn't say which side they're on.
- **Auto place reads only the form's own title.** It looks at the title to tell whose
  form it is, like "Exclusive Seller Representation Agreement" for the seller. Now it reads
  only the biggest heading at the top. It skips smaller header lines, and it skips a title
  that only names another form, like "Schedule to the …" or "Addendum to the …". Every
  form that worked before still works the same.

## 0.3.1 — 2026-11-04

- **Signed out of Real Signature? Dotted Line now waits while you sign in.** It used to
  say "reload this tab once", which didn't help. Now it says to sign in, keeps your forms
  from WEBForms waiting, and once you're signed in the icon shows an amber dot: click it
  to finish the draft. This now also works in the few minutes when Real Signature has
  ended your sign-in but the page hasn't caught up yet.
- **Assistants acting for an agent: no more error before you pick the agent.** When
  Real Signature opens on "Whose documents would you like to access?", Dotted Line used to
  stop with an error. Now the panel asks you to pick, your forms wait, and they load as soon
  as you have.
- **Auto place knows more Alberta forms.** The Referral Fee Consent, the customer
  disclosure and acknowledgement forms, the commercial and agricultural seller
  representation appendices, the Country Residential income schedule and the Fee
  Disclosure now get their blocks. A customer is someone you don't represent, on either
  side, so a customer's lines go to the side the form's title names. The general Customer
  Acknowledgement names no side: it used to place blocks for both buyer and seller, and
  now places only yours.
- **Auto place now knows Saskatchewan's Ancillary Services form (Form 910).** It places
  the date and both buyers' signatures. The "Initial here" box beside each service is the
  buyer's own choice, so it's left for them.
- **Auto place now knows CREA's REALTOR® Cooperation Disclosure and Consent Form** (the
  seller's signature and date) and both Certificate and Consent of Purchaser forms (the
  buyer's).
- **The email subject is never just "Please sign".** A standalone WEBForms form with no
  deal and no address left a subject like "Please sign: {deal} – {address}" with nothing
  to fill in. The form's name now goes after it, as it already did for uploads.
- **Only the sellers sign the REALTOR® Cooperation Disclosure and Consent Form.** With no
  deal, the panel used to suggest 2 buyers and 2 sellers.
- **No more spinning for minutes when Real Signature doesn't answer.** Dotted Line stops
  waiting after a minute (two for an upload) and says it couldn't reach Real Signature,
  instead of a bare "Failed to fetch". If the draft may have been made anyway, it says to
  check the Draft tab for a half-made copy.
- **Dotted Line says when it leaves a signature line for you.** If it can't tell whose a
  line is (the Customer Acknowledgement, or a Consumer Relationships Guide with both sides
  signing), it says which form, how many lines and why, instead of leaving them quietly.
- **Clearer error reports when Real Signature refuses.** If you've said yes to error
  reports, a report now says in one word why Real Signature refused (for example "not
  authorized" or "not found"), so we can fix problems we can't reproduce on our own
  account. Real Signature's message itself is never sent.
  A report also says when Chrome lost the Real Signature tab partway through a draft
  (closed, reloaded, or sent back to sign in), instead of "unknown".

## 0.3.0 — 2026-10-31

- **Auto place on a document you uploaded in Real Signature.** Upload a PDF to Send
  One-time Document, open it from your Draft tab, and the panel places its signature,
  initials and date blocks from its printed labels, as it does for WEBForms forms.
  - New uploads from the last week are listed in the panel, each with Set up: it fills
    the deal, signers, document name and email subject the same way as from WEBForms.
  - Anything you already chose in Real Signature stays: a deal picked, a name given, a
    subject typed, blocks already placed.
  - Packets too. Combine uploads into a packet and click Edit: the panel sets up every
    document at once (deal, signers, subject and blocks), and the packet keeps its name.
    On a packet whose signers are already in, Auto place this packet places blocks on each
    of its documents for that document's own signers.
  - The panel always shows the document or packet open in Real Signature, even with
    WEBForms open beside it.
  - A document added to a packet after Set up gets Set up too, starting from the
    packet's deal; the documents already set up stay as they are.
  - The panel says when a packet's documents are on different reZEN deals, since
    everyone on a packet gets every document in it.
  - When Real Signature leaves a signer on a document in a role it doesn't have (it
    does after a document is added to or removed from a packet), Dotted Line places
    nothing for them and says which documents to check.
  - When a form has a client signature line and the document has both buyers and
    sellers, the panel asks whose line it is.
  - The Disclosure of Remuneration's one client line gets both clients side by side.
- **Auto place: Alberta's commercial lease forms.** On a lease, the tenant signs where a
  buyer would and the landlord where a seller would: the Commercial Offer to Lease (each
  side's signing officers and its date and time), its Addendum (with its own time and
  date blocks), the Commercial Exclusive Tenant Representation Agreement, and the
  commercial Agency Relationships guide. A form is read as a lease only when it says
  tenant and landlord more than buyer and seller, so a purchase contract that mentions
  tenants is unchanged.
- **Auto place: Manitoba's Listing Contract.** Its text used to come out as nonsense
  (its font numbers letters in Apple's order), so it got no blocks. Now the sellers'
  signatures, your signature on the Listing Brokerage's line and the date are placed.
  Text printed off the edge of a page is no longer read. A date printed beside a
  signature line goes to that signer, and one date blank shared by everyone goes to
  Buyer 1 or Seller 1.
- **Auto place: more BC forms.** The Contract of Purchase and Sale's and Subject
  Removal's page-foot "BUYER'S INITIALS" and "SELLER'S INITIALS" boxes, Subject
  Removal's three buyer and three seller signature lines (printed as a picture, so found
  by where they sit), and the Disclosure of Multiple Offers Presented (sellers, the
  designated agent, and "Confirmed and signed this ___ Day of").
- **A clearer panel.** Each screen has a heading for its one job and the choices in the
  order you make them; forms and documents are listed as rows; the pressed button shows
  what it's doing; results and errors appear under it. The panel uses each site's own
  words: forms and the Basket for WEBForms, a document or packet for Real Signature.
- **When the forms and the deal disagree** on how many buyers or sellers, the panel says
  so under the numbers, with one click to use the deal's number instead (or back). A
  number you type is kept when you change a template.
- **No more "Reload this tab once".** A WEBForms or Real Signature tab opened before
  Dotted Line was installed or updated now gets Dotted Line added to it on the spot. This
  was the error reported most often.
- **Fix:** Alberta's Commercial Purchase Contract got the seller's signature and date in
  its REJECTION section too ("I/we do not accept this offer"). Nothing is placed there now.
- **Fix:** a client entered in reZEN as a company (a company name, no first or last name)
  made Real Signature refuse the whole document ("name must not be blank"). The company's
  name is now the signer's name; a client with no name at all is left off and named in
  the panel, like one with no email.
- **Fix:** on a numbered street ("120 9 Ave SE") the street's number counted as a house
  number, so another deal on the same street tied with the right one and no deal was
  picked. "9th Ave" and "9 Ave" now match too.
- **Fix:** with a deal picked, the number of buyers or sellers is the deal's own when the
  WEBForms forms don't name them (commercial forms, for one), not always at least 2.
- **Fix:** a name run on to a second line ("(operating as …)", "o/a", "aka", "trading as",
  "formerly …" under the name, on the form or in the Contacts) counted as a second buyer
  or seller, and a second line starting "& …" counted as two.
- **Fix:** Auto place put Alberta's Notice (waiver or satisfaction of conditions) on the
  sellers; its "Buyer/Seller Signature" lines now go to your own clients, whichever side.
- **Fix:** Check my setup now says "yes (own corporation)" when WEBForms is signed in as
  your personal real estate corporation, as the panel already did, instead of "no".
- **Error reports** (only if you said yes) now cover Import templates in Settings and Auto
  place on an uploaded document: Real Signature's answer is reported, never your file, its
  name or anyone's details.

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
