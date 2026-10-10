# Plan — Dotted Line by Deal Dates (WEBForms → Real Signature)

A free, open-source browser extension that takes forms an agent filled in CREA WEBForms
and lands them as a **Real Signature draft** on the matching reZEN deal, with signature,
initial and date blocks already placed. The agent reviews it and presses Send in Real
Signature. **The extension never sends anything to signers.**

Audience: Canadian Real Broker agents and their transaction coordinators. Agents have
asked Real for a WEBForms ↔ Real Signature integration; this is that, built by the team
behind [Deal Dates](https://dealdates.app).

## Decisions (2026-10-10)

| | Decision | Why |
|---|---|---|
| Price | **Free.** Credit "Made by the Deal Dates team" in the popup and on the "draft ready" screen; optional donation link. | Real may well build this natively; a free tool earns goodwill and puts Deal Dates in front of exactly its market. A subscription would need a server, invite piracy of public code, and look different to Real's lawyers. |
| Code | **Public, MIT.** | Agents are trusting it with contracts and their e-sign account; readable source is how they verify it. |
| Architecture | **No server. Nothing leaves the agent's browser** except to WEBForms and Real Signature themselves. | Nothing to host or breach; privacy reduces to "we collect nothing". |
| Auth | **The agent's own sign-ins, inside each site's own tab.** No API keys, no cookie permission, no token stored. | Real gates its API key per route (templates return `api_key_capability_missing`), and the browser session is what Real Signature's own app uses. |
| Platforms | **Desktop Chrome and Edge.** | Mobile Chrome/Edge run no extensions; Safari on iOS needs an App Store app built on a Mac. Revisit only if testers prove they fill forms on phones. |
| Telling Real | **After a working beta**, under the Deal Dates name. | A heads-up now just hands them the idea; a used beta is a partnership conversation. |
| Layouts | **Use Real Signature's own templates** as the layouts. | Agents already know the editor; teams can share templates natively (`/share/teams`). We build glue, not an editor. |
| Packages | **Separate PDFs → a Real Signature packet.** Merged single document only if testers ask. | One signing session either way; separate documents keep one template per form. |
| Sending | **Draft only.** | Sending emails clients; that stays a human decision in Real's own UI. |

## Terms review (2026-10-10) — shapes the design

Read in full: Lone Wolf Terms of Service (rev. 2025-02-21), Acceptable Use Policy
(rev. 2024-05-15), End User Agreement (2024-05-20) at legal.lwolf.com. **Not public:** the
CREA ↔ Lone Wolf contract members use WEBForms under (EUA §3 says its limits apply on top),
and AREA's form-copyright page (404). Not legal advice.

- Nothing bans browser extensions, scripts or automation as such. In our favour: ToS 2.4
  allows third-party products "sourced … externally"; ToS 8.2 the customer owns its data;
  ToS 6.4 expects users to download/export it.
- Against: AUP §1 — no interfering with or circumventing the Services, no overburdening
  them, no framing/reformatting their pages, and **no use to develop products "similar to or
  competitive with" the Services** (Real Signature competes with Lone Wolf's Authentisign).
  ToS 4.3(e) no derivative works of the UI; 4.3(f) third-party content (form copyright);
  4.3(g) never strip copyright notices from generated files.
- **Risk: low–medium.** If Lone Wolf objected, the consequence lands on the agent's account,
  not on us — so we design to be obviously the agent's own action.
- Lone Wolf has a licensed **partner API** for TransactionDesk (apidocs.lwolf.com, request
  form, launched Feb 2026). That is the clean long-term route, and Real is the right party to
  ask for it — raise it with Real when the beta is shown.

**Design rules that follow:**
1. Act only on the agent's click. No timers, no background batches; downloads spaced out.
2. **Drive WEBForms' own visible Save / Download controls** and reuse what they return —
   don't call its internal endpoints on our own.
3. **Don't change WEBForms' pages.** Our UI lives in the extension's own side panel, not a
   button injected into their page.
4. **PDFs pass through byte-for-byte.** No flattening, re-rendering or stripping footers and
   copyright notices — so splitting a combined PDF is a last resort (Phase 3, only if
   separate downloads prove impossible), and packets are the default.
5. No form PDFs, screenshots or filled samples in the repo or the store listing.
6. Name Lone Wolf, CREA and WEBForms only to say what it works with, with a "not affiliated"
   line. Market it as an agent convenience, not an Authentisign replacement.
7. Before public release: ask CREA (and AREA) whether sending their forms to a
   non-integrated e-signature service is permitted.

## How it works

```
WEBForms tab (pr.transactiondesk.com)           Real Signature tab (signature.therealbrokerage.com)
  agent ticks forms / is in an open form,
  opens our SIDE PANEL → [Create Real Signature draft]
    1. (open form) blur → app's own Save →
       confirm saveForm + saveMarkups 200 →
       LastModified moved
    2. app's own Download, one form at a time;
       we keep the bytes it returns, unchanged
    3. PDFs → extension (IndexedDB, short TTL) ──► 4. tab opens; panel asks:
                                                       · which reZEN deal (agent + address shown)
                                                       · which template per form (remembered)
                                                       · how many buyers / sellers
                                                    5. per form: template blocks + fresh PDF → draft
                                                       (one-time template, or packet)
                                                    6. lands the agent on the draft → they Send
```

Steps 4–6 run in the Real Signature page, using the page's own sign-in. If the agent is not
signed in, Real's own login appears and the hand-off resumes afterwards.

## Phases

### Phase 0 — prove it in the browser (one ~30 min session, drafts only)

Needs Dan at a computer, signed in to WEBForms and Real Signature in Chrome.

1. **Templates.** List my templates, shared-with-me, packet templates (field names, counts).
2. **Apply a template to a fresh PDF** — try both, on drafts:
   a. clone the template (one-time) then `PUT /document-templates/{clone}/pdf` with the new
      PDF — do the blocks survive?
   b. upload the PDF as a one-time draft, then `PUT /document-templates/{id}` with the
      template's `fieldDefinitions` copied in.
   Open both in Real Signature's editor: blocks visible, movable, assignable?
3. **`position[]` units** — compare one block against `page-info.viewport`.
4. **Packets** — capture `POST /packets` from the UI on a draft.
5. **Draft URL** — the route the editor opens a draft at, so step 6 can land there.
6. **WEBForms** — how to capture the bytes of the app's OWN download (rule 2): watch the
   page's `CreateDownloadRequest` response for its token and fetch the same `downloadmany`
   URL the browser is sent to, or use `chrome.downloads`; whether a multi-form download is
   one PDF or a zip; a single-form download from the open editor; selection state (which
   forms are ticked) readable without touching the page.
7. **Delegation** (with the TC, at her own computer, signed in herself) — does Real Signature
   need "assistant may send for me" set up; who shows as sender on a draft she creates; can
   she use team-shared templates; do WEBForms downloads work while she impersonates an agent.

Exit: every step above answered and written into `docs/api-notes.md`. If 2a and 2b both fail
— Real's editor won't accept blocks it didn't place — stop and rethink layouts.

### Phase 1 — MVP: ticked forms → draft

- Side panel on a deal's Forms page lists the ticked forms; "Create Real Signature draft" runs
  the app's own download for each, separately.
- Deal picker in the Real Signature tab: the agent's OPEN deals and listings, ranked by
  address match to the WEBForms transaction, **showing agent name and address**.
- Form → template mapping: chosen once, remembered in the browser, suggested by name after;
  **refused when page counts differ** (form revised).
- Signer slots: unused Buyer 2 / Seller 2 blocks removed; names and emails pre-filled from
  the reZEN deal's clients when available.
- One form → one-time document draft; several → packet draft.
- Fails loudly: any step failing stops with a plain message and nothing half-made left
  behind (best effort: delete drafts it created in the failed run).

### Phase 2 — open-form mode

From inside an open form: blur, Save through the app, confirm the save landed, then Phase 1.
**Never send a stale copy.**

### Phase 3 — polish for others

- How-to: building a Real Signature template for a CREA form (with the Winnipeg tester).
- Combined single-document mode only if testers ask AND it can be had without altering the
  PDFs (page-offset merge of templates is ready in `src/lib/layout.js`).
- Optional: suggest block positions on a form with no template, from "Initials" /
  "Signature" labels in the PDF text — suggestions only.

### Beta

| Order | Who | Proves |
|---|---|---|
| 1 | Dan | Phase 0, the MVP |
| 2 | TC (Real `TRANSACTION_COORDINATOR` on every team deal; WEBForms impersonation) | delegated drafts, impersonation, wrong-deal guard across many agents |
| 3 | Stante team | everyday use, team-shared templates |
| 4 | Winnipeg agent | another province's forms, install from the store link with only the how-to |

Install from an **unlisted** Chrome Web Store link during beta.

## Safety rules (built in, not just policy)

- The Real Signature client has **no send function** — `POST /documents` and
  `/resend-signature-email` are not implemented, and a test fails if they appear.
- Acts only on an explicit click; never in the background.
- Runs only on `pr.transactiondesk.com` and `signature.therealbrokerage.com`.
- No analytics, no remote code, no server.
- **Wrong-deal guard**: warn when the WEBForms account (or impersonated agent) differs from
  the reZEN deal's agent, and when the addresses don't match.
- Templates read for layouts are stripped to blocks only (no names, emails, deal).
- PDFs held only until the draft is made, then deleted; anything older than an hour is
  purged on startup.
- No real deals, names or addresses anywhere in this repo — test data is invented
  (`120 Example Street NW`, `Jordan Sample`).

## Open questions

- CREA's own WEBForms terms (not public) and AREA form copyright — ask before public release.
- Real Signature's draft URL; `position[]` units; packet body; delegation model.
- WEBForms auth header; combined vs zip downloads.
- Repo: `stante-group/dotted-line`. Store name "Dotted Line by Deal Dates" — chosen 2026-10-10 over RealDealForms, which read as an official Real tool (Web Store affiliation rule, Real, Lone Wolf).

## Reference

Real Signature API map: Stante `content-engine/docs/rezen-api-mapping.md` §Real Signature;
WEBForms map: `content-engine/docs/webforms-real-signature.md`. Summaries go into
`docs/api-notes.md` here so this repo stands alone.

## Copy rules (brand review 2026-10-10)

- Lead with **Create / Turn into a draft**, never "Send" — the product's promise is that it
  doesn't send. Button: "Create Real Signature draft".
- Say where contracts go in plain words ("straight from WEBForms to Real Signature, never
  through us"), not "no server" / "open source" first.
- Never mention Authentisign or DocuSign, "replace" or "instead of" (Lone Wolf AUP).
- Third-party names only to describe compatibility; no logos; keep "REALTOR®" out of
  marketing copy. Legal disclaimer names The Real Brokerage Inc.
- Deal Dates credit gives a reason to click: "your deal deadlines in your inbox at 6am".
- Store screenshots: invented forms and data only.
