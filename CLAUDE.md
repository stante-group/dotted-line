# realdealforms

Public repo. Read PLAN.md first; API shapes are in docs/api-notes.md.

## Rules that are the product, not preferences

- **Draft only.** Nothing here may send to signers. `src/lib/realsig-api.js` refuses the
  send routes and `test/realsig-api.test.js` fails if a send function appears. Don't
  weaken either to "just test something".
- **No server, no telemetry, no remote code.** If a feature seems to need a backend, it
  belongs in Deal Dates, not here.
- **Don't touch WEBForms' pages or PDFs** (Lone Wolf AUP — see PLAN.md "Terms review").
  UI goes in the side panel; PDFs pass through byte-for-byte.
- **Public repo: invented data only.** No real forms, deals, names, addresses, emails,
  template exports or screenshots. Fixtures use `120 Example Street NW`, `Jordan Sample`.
  `git rm` does not undo a leak.
- Real Signature and WEBForms APIs are undocumented. When a shape doesn't match, throw a
  plain message — never guess and carry on.

## Development

`npm test` (Node ≥ 20, no dependencies). `src/lib/` is pure and tested; content scripts
load it with `import(chrome.runtime.getURL(...))`.
