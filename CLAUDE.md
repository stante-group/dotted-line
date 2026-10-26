# dotted-line

Public repo. Read PLAN.md first; API shapes are in docs/api-notes.md.

## Rules that are the product, not preferences

- **Draft only.** Nothing here may send to signers. `src/lib/realsig-api.js` refuses the
  send routes and `test/realsig-api.test.js` fails if a send function appears. Don't
  weaken either to "just test something".
- **No server, no remote code, and nothing leaves except an opt-in report.** If a feature
  seems to need a backend, it belongs in Deal Dates, not here. The one exception (Dan,
  2026-10-26) is error reports and a daily draft count, sent to dealdates.app only after
  the agent says yes. `src/lib/report.js` decides what a report may hold: fixed choices,
  numbers and pattern-checked codes, never text. Add a field there or nowhere, never as
  free text, and `test/report.test.js` must keep failing on any client detail and on any
  new network call. PRIVACY.md lists the fields: change both together.
- **Don't touch WEBForms' pages or PDFs** (Lone Wolf AUP — see PLAN.md "Terms review").
  UI goes in the side panel; PDFs pass through byte-for-byte. `src/lib/webforms-api.js`
  is an allowlist: its zip download plus read-only lookups. Never add a route that saves,
  sends, moves or deletes, and `test/phase1.test.js` checks the obvious ones are refused.
- **TC delegation (verified 2026-10-15)** works by acting AS the agent: Real's
  `actingAsUserId` cookie → the `X-Agent-Context` header on every call, exactly as Real's
  app does. Never fake or choose that id ourselves — it is the TC's own pick in Real
  Signature, and the agent must have switched on Real Signature for her in reZEN.
  `sender.agentYentaId` stays null. See docs/api-notes.md "Transaction coordinators".
- **Public repo: invented data only.** No real forms, deals, names, addresses, emails,
  template exports or screenshots. Fixtures use `120 Example Street NW`, `Jordan Sample`.
  `git rm` does not undo a leak.
- Real Signature and WEBForms APIs are undocumented. When a shape doesn't match, throw a
  plain message — never guess and carry on.

## Development

`npm test` (Node ≥ 20, no dependencies). `src/lib/` is pure and tested; content scripts
load it with `import(chrome.runtime.getURL(...))`.

Code-quality baseline: `.claude/skills/coding-standards` (vendored from affaan-m/ECC at
`d29cf65`, MIT — LICENSE beside it; re-copy to update, don't edit in place). It is written
for TypeScript, React and Next.js; this repo is plain JavaScript with no build step, no
dependencies and no server, so its typing, React, API-design, Zod and folder-layout advice
doesn't apply. Where it and this file disagree, this file wins.
