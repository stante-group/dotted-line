# WEBForms → Real Signature

A free, open-source browser extension for Canadian Real Broker agents and their
transaction coordinators. It takes forms you filled in **CREA WEBForms** and creates a
**Real Signature draft** on the matching reZEN deal, with your signature, initial and date
blocks already placed from your Real Signature templates.

**Status: in development.** Not yet installable. See [PLAN.md](PLAN.md).

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

Made by the team behind [Deal Dates](https://dealdates.app).

Not affiliated with or endorsed by Lone Wolf Technologies, CREA or Real Broker. WEBForms®,
REALTOR® and Real Signature are trademarks of their owners and are named only to describe
what this works with.

## License

MIT — see [LICENSE](LICENSE).
