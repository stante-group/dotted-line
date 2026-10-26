# Dotted Line by Deal Dates

A free browser extension for Canadian Real Broker agents and transaction coordinators.
It turns the forms you filled in **CREA WEBForms** into a **Real Signature draft** on the
matching reZEN deal, with your signature, initial and date blocks already placed from your
Real Signature templates. You review the draft and press Send yourself.

Open source, so anyone can check exactly what it does.

**Install:** [Dotted Line on the Chrome Web Store](https://chromewebstore.google.com/detail/dotted-line-by-deal-dates/hohklnkceafdacdmlngcbbhaokeoonkl)
(desktop Chrome or Edge). It's an unlisted beta: only people with the link can find it.
See [PLAN.md](PLAN.md) for what's next.

## How it works

1. In WEBForms, tick the forms in a deal's **Forms** list — or, for standalone forms, add
   them to the **Basket** inside each form's folder.
2. Click the Dotted Line icon (a small popup opens over WEBForms), check the title, click **Prepare in Real Signature**.
   It uses WEBForms' own zip download and keeps the PDFs exactly as WEBForms made them.
3. **When the choices are clear, that's it.** If one reZEN deal clearly matches the
   address and every form has its usual template, the draft is made straight away and
   you land on it (or a packet, for several forms), deal and signers filled in. Check it
   and press Send yourself.
4. **Otherwise Real Signature opens with a panel** that says what needs you. Check the
   reZEN deal (best address match first) and pick a template for each form — it's
   remembered, so next time that form goes through in one click. It's remembered per side,
   because Real Signature ties every block to a role: a form both sides sign, like the
   Consumer Relationships Guide, wants a buyer template and a seller one, and a template
   with blocks only for the side that isn't signing is never applied. The signers are worked
   out for you: your side's clients from the deal (as many as are named on the form, or two
   when the form names nobody), and the agent when the template has agent blocks.
   **Finish draft** and you land on it, as above.

It falls back to the panel, too, when the deal is another agent's or a client on it has no
email in reZEN — both are worth a look before the draft exists.

## Settings

Optional. **Settings** at the bottom of the panel opens a page where you can:

- turn off the one-click draft, so the panel always opens for you to check first — or go
  further and start as soon as you click the Dotted Line icon, with no Create button;
- choose the draft title: the suggested one, blank, or your own pattern such as
  `{address} – {forms}`, built by clicking words, with a preview;
- choose the email subject signers see: the same as the title, your own pattern, or Real
  Signature's default;
- see the template remembered for each kind of form, and remove any you want to choose
  again;
- import templates from your previous e-sign tool's template files (.json, or a .zip of
  several): signatures, initials, dates, text boxes and ticks become a new Real Signature
  template, after you confirm who each role is.

Left alone, you get the suggested title, used as the email subject too. Title and subject
settings follow your Chrome sign-in (Chrome sync); remembered templates stay in this browser.

### How the address in the title is written

The address comes from the WEBForms transaction when the forms belong to one, otherwise
from the first form that has an address. It is written Canada Post style, unit first:

| Typed in WEBForms | In the title |
|---|---|
| Unit `#120`, number `1234`, street `Example Street NW`, city `Calgary` | `120-1234 Example Street NW, Calgary` |
| Whole address in the street field: `120, 1234 Example Street NW, Calgary AB T2X 0A1` | `120, 1234 Example Street NW, Calgary` |
| The same, plus `#120` in the unit field | `120-1234 Example Street NW, Calgary` |
| No civic number anywhere (`Lot 4, Example Estates`) | no address |

- `Unit`, `Suite`, `Apt` and `#` in front of a unit are dropped.
- A province and postal code in the city or street field are dropped; the city is kept.
- The title is built from the form **as last saved** — the copy Real Signature gets. Save in
  WEBForms first; with unsaved changes, Create stays off.
- The title is always editable before you create the draft.

## What it does — and doesn't

- ✅ Creates a **draft**. You review it and press **Send** in Real Signature yourself.
- ❌ **Never sends anything to signers.** The code has no send function; a test fails if one
  appears.
- ✅ Runs only in your browser, using your own WEBForms and Real Signature sign-ins.
- ❌ **Your contracts never go through us.** They go from WEBForms to Real Signature and
  nowhere else. No tracking, no account.
- ✅ **Error reports only if you say yes.** A short report when a draft fails, and a daily
  count of drafts that worked, so problems get fixed without you telling us. Fixed choices
  and numbers only, never a name, address, deal or form ([what's in one](PRIVACY.md));
  `src/lib/report.js` is the whole list.
- ✅ Only runs on `pr.transactiondesk.com` and `signature.therealbrokerage.com`, and only
  when you click.
- ❌ Does not change WEBForms' pages or your forms. PDFs pass through unchanged.

## Development

```
npm test        # node's built-in test runner, no dependencies
```

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → this folder.

Test data in this repo is invented (`120 Example Street NW`, `Jordan Sample`). Never commit
a real form, deal, name or address — including in screenshots.

## Credits

From [Deal Dates](https://dealdates.app) — your deal deadlines in your inbox at 6am.

Not affiliated with or endorsed by Lone Wolf Technologies, CREA or The Real Brokerage Inc. WEBForms®, Real Signature, reZEN and TransactionDesk are trademarks of their owners, named only to describe what this works with.

## License

MIT — see [LICENSE](LICENSE).
