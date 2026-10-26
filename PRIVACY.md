# Dotted Line — privacy policy

Last updated: October 26, 2026

Dotted Line is a free, open-source browser extension made by the Deal Dates team. It
turns forms you filled in CREA WEBForms into a draft in Real Signature.

## What it handles

When you press Finish draft, Dotted Line works with:

- the forms you ticked in WEBForms (the PDFs, and the names and emails of the people on
  them);
- your reZEN deals, listings, buyer records and Real Signature templates, so it can pick
  the deal and place the signature blocks;
- your name and email from Real Signature, to set you as the sender.

## Where it goes

Only between WEBForms and Real Signature, inside your own browser, using your own
sign-ins. The forms go from WEBForms to a draft in your Real Signature account, and
nowhere else.

Your forms, your clients' details and your deals never go to the Deal Dates team or
anyone else. Dotted Line has no tracking or advertising, and never reads or stores your
passwords. The one thing it can send us is described next, and only if you say yes.

## Error reports, if you say yes

The first time you open Dotted Line it asks whether it may send error reports. Until you
answer, and if you answer no, it sends nothing. You can change your answer any time in
Dotted Line's Settings.

With your yes, it sends the Deal Dates team:

- **a report when a draft fails:** which step failed (bringing the forms over, loading
  your deals, or making the draft); the kind of error and its code, such as "Real
  Signature refused the email subject: longer than 70 characters"; and choices about the
  draft, such as "the deal was matched by address", "2–3 forms", "a template on every
  form", "acting as an agent in Real Signature" or "WEBForms and Real Signature are signed
  in as the same person";
- **once a day, a count of drafts that worked**, by how they were made (one click or the
  side panel) and how many forms they had;
- with both, the Dotted Line and Chrome version numbers, and how many drafts this browser
  has made and how many failed.

A report never contains your forms or any name, email, address, phone number, MLS number,
deal, template name or file name. Every field is a fixed choice or a number: the code is
public, and `src/lib/report.js` is the whole list. You can see exactly what a report holds
under "What's sent" when an error shows.

Reports carry no account, no ID and no cookie, and your IP address is not stored (it is
used for a moment to stop anyone flooding the service, then discarded). So a report isn't
tied to your name. While only a few people use Dotted Line, though, we may be able to
tell whose browser a report came from, the way a small office knows whose handwriting a
note is in. We use reports only to find and fix problems in Dotted Line.

Reports are kept for 12 months, then deleted. They are stored with Cloudflare, which runs
dealdates.app, and are not sold or shared with anyone.

If you say no, an error still offers a **Send this error** button, which sends that one
report once you press it.

## What it keeps

On your own computer, in the extension's storage:

- your Dotted Line settings (Chrome may sync these through your own Chrome profile);
- which Real Signature template you chose for each form, so it can choose it again;
- the names of your WEBForms form library, so it can recognise forms;
- how long each step of your last draft took, for "Check my setup";
- how many drafts it has made and how many failed, your answer about error reports, the
  last error report (for its Send button) and today's count of drafts that worked.

While a draft is being made, the forms and their signers wait in the extension's storage
until the draft is done, and are deleted then — or after an hour if you never finish it.
Otherwise it does not keep your forms, clients' details or deals. Removing the extension
removes everything it kept.

## Sending

Dotted Line never sends anything for signature. It stops at a draft, and you send it
yourself in Real Signature.

## Contact

Questions: open an issue at https://github.com/stante-group/dotted-line/issues.
The code is public, so you can check all of the above yourself.
