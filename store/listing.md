# Chrome Web Store listing — Dotted Line

Paste-ready text for the Developer Dashboard (chrome.google.com/webstore/devconsole).
Rules for everything here: never name the other e-sign tools; never say "Send" as
something we do; no live client names, addresses or screenshots of real deals.

## Store listing tab

**Name** (from the manifest): Dotted Line by Deal Dates

**Summary** (manifest description, 132 chars max):
Turn the forms you filled in WEBForms into a Real Signature draft on your reZEN deal, with signature blocks placed. You review it and press Send yourself. Free.

**Category:** Productivity → Workflow & Planning
**Language:** English (Canada)

**Description:**

Dotted Line moves the forms you filled in CREA WEBForms into Real Signature for you, as a draft on the right reZEN deal.

How it works
1. In WEBForms, tick the forms you want signed.
2. Click the Dotted Line icon and press Finish draft.
3. Dotted Line downloads those forms from WEBForms, opens Real Signature, picks the matching reZEN deal and adds the signers.
4. Your saved Real Signature templates place the signature, initial and date blocks.
5. You check the draft in Real Signature and send it yourself.

What it never does
- It never sends anything to anyone. It stops at a draft; only you press Send.
- It doesn't change your WEBForms forms or pages.
- It doesn't alter your PDFs — the pages go over exactly as WEBForms made them.
- It has no server, no account and no analytics. It works with your own sign-ins, in your own browser, on two sites only: WEBForms and Real Signature.

For transaction coordinators
If an agent has given you Real Signature access in reZEN, pick them under "Acting as" in Real Signature and the draft goes into their Drafts, with them as sender. Dotted Line warns you when WEBForms and Real Signature are signed in as different people.

Free and open source (MIT): https://github.com/stante-group/dotted-line

Made by the Deal Dates team — your deal deadlines in your inbox at 6am (dealdates.app).
Dotted Line is an independent tool. It is not made, endorsed or supported by Lone Wolf Technologies, CREA or Real Broker. WEBForms, reZEN and Real Signature are their owners' trademarks.

**Icon:** icons/icon-128.png
**Small promo tile (440×280):** store/dotted-line-store-tile-440x280.png
**Screenshots (1280×800), in this order:** store/screenshot-1-webforms.png,
store/screenshot-2-real-signature.png. Made from store/demo/ — the real panel code fed
invented data by mock.js, never a real deal. To remake: `bash store/demo/make.sh`, then
capture as its header says.

**Official URL / homepage:** https://github.com/stante-group/dotted-line
**Support URL:** https://github.com/stante-group/dotted-line/issues

## Privacy practices tab

**Single purpose:**
Create a Real Signature draft from forms the user filled in CREA WEBForms.

**Permission justifications:**
- `sidePanel` — the Dotted Line panel opens beside Real Signature so the agent can review the deal, signers and templates before the draft is made.
- `storage` — remembers the user's settings and which Real Signature template they chose for each form, on their own computer (settings sync through their own Chrome profile).
- `scripting` — reads which forms the user ticked in the open WEBForms page, when they click the Dotted Line button.
- Host permission `pr.transactiondesk.com` — downloads the forms the user ticked, from WEBForms, using their own sign-in.
- Host permission `signature.therealbrokerage.com` — reads the user's deals and templates and creates the draft in Real Signature, using their own sign-in.

**Remote code:** No, I am not using remote code. (All code ships in the package.)

**Data usage — what is collected:** tick
- Personally identifiable information (the signers' names and emails move from the forms to the Real Signature draft)
- Website content (the form PDFs)
- Authentication information? — NO: it never reads or stores a password or token; it uses the sites' own signed-in session.

**Certifications (tick all three):**
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/stante-group/dotted-line/blob/main/PRIVACY.md

## Distribution tab

**Visibility:** Unlisted (beta: Dan → TC → team → outside agent). Public after the beta.
**Regions:** Canada.
**Price:** Free.
