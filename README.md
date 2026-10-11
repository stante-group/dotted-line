# Dotted Line by Deal Dates

A free browser extension for Canadian Real Broker agents and transaction coordinators.
It turns the forms you filled in **CREA WEBForms** into a **Real Signature draft** on the
matching reZEN deal, with your signature, initial and date blocks already placed from your
Real Signature templates. You review the draft and press Send yourself.

Open source, so anyone can check exactly what it does.

**Status: in development.** First working version being tested; not in the Chrome Web
Store yet. See [PLAN.md](PLAN.md).

## How it works

1. In WEBForms, tick the forms in a deal's **Forms** list — or, for standalone forms, add
   them to the **Basket** inside each form's folder.
2. Open the Dotted Line side panel, check the title, click **Create Real Signature draft**.
   It uses WEBForms' own zip download and keeps the PDFs exactly as WEBForms made them.
3. Real Signature opens. In the panel, pick the reZEN deal (best address match first) and a
   template for each form — it remembers your choice next time.
4. **Create draft.** You land on the draft (or a packet, for several forms) in Real
   Signature. Check it and press Send yourself.

## What it does — and doesn't

- ✅ Creates a **draft**. You review it and press **Send** in Real Signature yourself.
- ❌ **Never sends anything to signers.** The code has no send function; a test fails if one
  appears.
- ✅ Runs only in your browser, using your own WEBForms and Real Signature sign-ins.
- ❌ **No server, no analytics, nothing collected.** Your contracts go from WEBForms to Real
  Signature and nowhere else.
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
