# TC delegation test (Phase 0 item 7)

Run once with a transaction coordinator, **at her own computer, signed in herself** to both
WEBForms and Real Signature. Nobody else types her passwords. Drafts only: nothing in this
test presses Send. Use a test deal or invented forms where you can.

The code is ready for this: `src/lib/actor.js` holds every assumption the test checks, and
`DELEGATION_VERIFIED` stays `false` until it is done.

## 1. Setup check (2 min)

With WEBForms and Real Signature both open in tabs, open the Dotted Line panel →
**Check my setup** → **Run check**. Copy the report (counts and yes/no only) into the notes.

| Line | What we learn |
|---|---|
| Open deals visible: own / other agents' | Is she a participant on the team's deals, so the deal picker can show them? |
| Real account type, roles | What Real calls a TC (does `TRANSACTION_COORDINATOR` show up?) |
| Templates: shared with me | Can she use templates agents shared with her or the team? |
| Same person in both | Is WEBForms signed in as her, or as the agent she impersonates? |

## 2. Real Signature by hand, no extension (5 min)

On one of an agent's deals, upload an invented PDF in Real Signature, attach the deal,
add a made-up signer, place one block, **Save as Draft**. Then note:

- Whose name shows as **sender** on Review? Can she change it to the agent?
- Is there an "on behalf of" or delegation setting anywhere (Settings, the agent's profile)?
- Does the draft show in the **agent's** Drafts list as well as hers?

Then, in her browser's DevTools console on that Real Signature tab, read back the draft's
sender (field names and whether each is set, no values):

```js
const id = location.pathname.split("/").pop();
const jwt = decodeURIComponent(document.cookie.match(/jwtToken=([^;]+)/)[1]);
const t = await (await fetch(`https://signature-api.therealbrokerage.com/api/v1/document-templates/${id}`,
  { headers: { Authorization: `Bearer ${jwt}` } })).json();
Object.fromEntries(Object.entries(t.defaults?.sender || {}).map(([k, v]) => [k, v ? "set" : "empty"]));
```

The question that matters is whether `agentYentaId` is **set** when a TC prepares a
draft on an agent's deal. If it is, Real records "on behalf of" there, and the extension
should do the same. Delete the test draft afterwards.

## 3. WEBForms impersonation (3 min)

If she works in agents' WEBForms accounts by impersonating them: impersonate one, open a
deal's Forms list, tick a form, and open the Dotted Line panel. Note:

- Does the panel list the ticked form?
- Run **Check my setup** again: does "Same person in both" change?
- Does **Create Real Signature draft** get as far as opening Real Signature? (Stop there,
  or carry on with an invented form only.)

## 4. Full run (5 min)

With invented forms, go end to end: tick → Create → pick the agent's deal → templates →
Create draft. Check the draft in Real Signature: deal, signers, blocks, sender. **Don't
send.** Delete it afterwards.

## After the test

Write the answers into `docs/api-notes.md` (field names only) and then, in
`src/lib/actor.js`:

- if Real sets `agentYentaId` for a TC's draft: make `senderFor()` set it to the deal
  owner's id when `isOthersDeal()`, and add a test;
- set `DELEGATION_VERIFIED = true` and reword the note in `actingNotes()`;
- update PLAN.md Phase 0 status.
