# API notes

Neither service publishes an API for this. Everything here was observed in each web app's
own network traffic (2026-10-09/10) or read from its own JS client. Field names only —
never paste real deal data here. **Treat it as reverse-engineered and liable to change**;
the extension must fail loudly when a shape stops matching.

## Real Signature

- App `signature.therealbrokerage.com`; API `signature-api.therealbrokerage.com/api/v1`.
- Auth: the app holds a JWT in a JS-readable cookie `jwtToken` and sends
  `Authorization: Bearer <jwt>`. Cross-origin calls are only accepted from the app's own
  origin, which is why the extension works from inside that tab.
- Real's server-side API keys are gated per route: `/sent-items` works with a key, the
  template routes answer `403 api_key_capability_missing` / `endpoint_not_api_key_accessible`.
- Files live in S3 behind presigned URLs. The editor renders page PNGs from `page-info`.

### Create a draft (observed)

1. `POST /document-templates?documentType=USER_PDF&oneTimeUse=true` — multipart, one `file`
   part → `{id}`. A one-time **draft**; nothing is emailed.
2. `PUT /document-templates/{id}` → `204`. **Full replace.** `name, type, draft, pagesCount,
   defaults {transactionId, signees[] {name, email, signeeType, signeeIndex, signOrder},
   recipients[], sender, emailSubject, emailBody}, signeeConfigs[] {signeeType, minNum,
   maxNum}, fieldDefinitions[] {index, type, displayName, signeeType, signeeIndex,
   fieldLocations[] {pageNum, position[]}, formatting {fontSize}},
   documentFieldValidations[] {fieldIndex, validationType: REQUIRED}`.
3. **Not used by this extension:** `POST /documents` sends (emails the signers);
   `DELETE /documents/{id}` voids.

### Packet drafts (observed 2026-10-11)

Real's UI has no "packet" choice at upload: each PDF uploads as its own one-time draft
(as above). On the Draft list the agent ticks drafts and creates a packet, which calls:

- `POST /packet-templates` with `{name, oneTimeUse: true, documentTemplates:
  [{documentTemplateId}]}` → `{id}`. The member drafts leave the Draft list as separate rows
  and show as one packet row. Nothing is emailed.
- The packet opens at `/one-time-documents/packet/{id}` (Transaction → Edit details →
  Prepare → Review). The deal is chosen once for the packet; signer roles are per document.
- `GET /packet-templates/{id}` → `{id, name, oneTimeUse, shareConfigs, documentTemplates[]}`,
  each a full document template (`fieldDefinitions`, `signeeConfigs`, `defaults`, …). The
  packet has no `defaults` of its own; where the packet-level deal is stored is not yet
  observed (likely each document's `defaults.transactionId`).
- Other routes in the app's client: `PUT /packet-templates/{id}`,
  `POST /packet-templates/{id}/document-templates` (add documents),
  `POST /packet-templates/draft`, `/clone`, `/from-packet`, `/share/*`,
  `DELETE /packet-templates/{id}`.
- **`/packets` are SENT packets.** `POST /packets` sends; `POST /packets/{id}/recipients`,
  `PUT /packets/{id}/signees/{id}`, `/resend-signature-email`, `DELETE /packets/{id}` act
  on live ones. The client refuses all of them.

### Phase 0 findings (2026-10-11, drafts only)

- `GET /document-templates?sharedWithMe=&oneTimeUse=false&page=&size=` →
  `{data[], pageNumber, pageSize, totalCount}`; each item carries full `fieldDefinitions`.
- `GET /document-templates/{id}/page-info` → `documentImages.pages[] {pageNumber, viewport
  {width, height, viewBox, rotation…}, path}` (presigned PNG). Letter = 612×792.
- **`position` = `[x1, y1, x2, y2]` in PDF points, origin BOTTOM-left** (PDF-native, y up).
  Proven by overlaying stored boxes on the page image: bottom-origin lands on the signature
  lines, top-origin lands on nothing. Typical sizes: SIGNATURE 150×21, SIGNED_DATE 65×21,
  INITIALS 40×25.
- **Method 2b works.** Upload a one-time draft, then `PUT` it with a template's
  `signeeConfigs`, `fieldDefinitions` and `documentFieldValidations` → `204`; Real's own
  editor shows every block on the new PDF, coloured per signer, at the template's spots.
  `pagesCount` is `null` straight after upload; sending `1` was accepted. `defaults` was
  `null` and accepted as `null`.
- Fields also carry `defaultValue` and `readonly`; set `defaultValue: null` when copying so
  a template's typed-in text doesn't ride along.
- Editor URL for a template or draft: `/prepare/{id}` (Upload → Edit details → Prepare →
  Review).
- Many real templates are text-fill only (`STRING`/`SENDER`, no signature blocks). Layout
  reuse only helps where a template actually has SIGNATURE/INITIALS/SIGNED_DATE fields.

### Other routes the app's client has (not yet observed)

`GET /document-templates` (`sharedWithMe`, `oneTimeUse`, `page`, `size`),
`GET /document-templates/{id}`, `POST /document-templates/{id}/clone`,
`PUT /document-templates/{id}/pdf` (multipart `file`), `DELETE /document-templates/{id}`,
`GET /documents/timezone?transactionId=`,
`GET /reference/document-signee-types`.

### Values

- Field `type`: `SIGNATURE, INITIALS, SIGNED_DATE, SIGNED_DATE_ONLY, SIGNED_TIME_ONLY,
  STRING, TEXTAREA, NUMBER, DATE, BOOLEAN, RADIO, STRIKETHROUGH`, auto-fill `SIGNEE_*`,
  `AGENT_*`, `TRANSACTION_*`.
- `signeeType`: `BUYER, SELLER, BUYERS_AGENT, SELLERS_AGENT, … , WITNESS, SIGNER, OTHER`.
  A slot is `signeeType` + `signeeIndex` (0-based): Buyer 1 = `BUYER`/0.

## reZEN (deal picker, from the Real Signature tab)

`arrakis.therealbrokerage.com/api/v1`:
`GET /transactions/participant/{yentaUserId}/transactions/OPEN` and
`…/listing-transactions/OPEN` (`searchText, pageNumber, pageSize, sortBy, sortDirection`) —
what Real Signature's own deal picker calls. A TC appears as a participant on every deal she
coordinates, so her list covers the team. Hand-typed fields carry stray whitespace (a TAB
before an MLS number has been seen) — normalise before comparing.

## WEBForms (`pr.transactiondesk.com`)

- Forms on a deal: `GET /api/transactionforms/index/{transactionId}` →
  `[{ID, Name, Order, IsFinalized, LastModified, …}]`.
- Download: `POST /api/Transfer/CreateDownloadRequest?type=1` with `[{Id, Name}]` → GUID
  token; then `GET /api/Transfer/downloadmany?token=` (single:
  `DownloadSingleWithCriteria?token=`).
- Open form editor `/form/{formId}/{bool}` loads `GET /api/formeditor/formfields/{formId}`
  (`FormGUID`, `PageCount`, …) and `GET /api/forms/single/{formId}` (`LastModified`, …).
- **No auto-save.** Save = `PUT /api/formeditor/saveForm/{formId}` then
  `POST /api/formeditor/saveMarkups/{formId}`. A `beforeunload` guard marks unsaved edits.
- **Auth (Phase 0, 2026-10-11):** `Authorization: Bearer <token>`. The token is opaque (not
  a JWT, ~580 chars) and JS-readable in two places that hold the same value: localStorage
  `ls.lastBearer` (JSON-quoted string) and cookie `bearer`.
- **Single-form "Save as PDF"** (form editor → File → Save → Save as PDF):
  1. the app first **saves the form** — `PUT /api/formeditor/saveForm/{formId}` then
     `POST /api/formeditor/saveMarkups/{formId}` (same as the Save button);
  2. then the **browser navigates** (no XHR, no blob) to
     `GET /api/Transfer/downloadsingle?type=formeditorpdf&id={formId}&filenametouse={name}`,
     which downloads the PDF as `{form name}.pdf`. Auth for that navigation rides on the
     `bearer` cookie. Plain `%PDF-1.4`, flattened (no AcroForm).
  The extension doesn't use this route: it would save the agent's form as a side effect.
  It uses the zip download below, which reads each form as last saved.
- **Multi-form downloads** from the deal's forms list (tick forms, then download), both
  captured 2026-10-11:
  - **As zip — use this.** `POST /api/Transfer/CreateDownloadRequest?type=1` (XHR, Bearer)
    with `[{Id, Name}]` → token; then the browser navigates to
    `GET /api/Transfer/downloadmany?token=…` → a zip with **one flattened PDF per form**,
    named `{form name}.pdf` (`/` and `:` become `_`). Each entry is the same as that form's
    single "Save as PDF" (same size ± a few bytes, no AcroForm). No splitting needed.
  - **As one PDF** — browser navigates to
    `GET /api/Transfer/printpdf?name=&saveToDocBox=false&transactionId=&id=&id=…` → one
    combined PDF that **does** carry an AcroForm. Avoid: it would need splitting, and isn't
    the flattened form.
  - `saveToDocBox=true` would also file a copy in the deal's Documents; keep it `false`.
- **Which forms are ticked** (forms list, read-only): each row has a `.dr-item-selector`
  (attribute `is-selected`) whose icon is `i.isfontpack-ok_circle.is-green` when ticked and
  `i.isfontpack-circle_blank` when not. Its Angular scope holds `form` (`ID`,
  `TransactionID`, `Name`), but an isolated-world content script can't read scopes; either
  read it from a MAIN-world script (`chrome.scripting`, `world: "MAIN"`) or match row order
  and name against `GET /api/transactionforms/index/{transactionId}`. The deal id is in the
  page URL: `/transaction/detail/{transactionId}/forms`.
- **Transaction details** (read-only, the page loads it): `GET /api/transactions/Basic/{transactionId}`
  → `Name` (the transaction's name, e.g. "Offer to Purchase 120 Example Street NW"),
  `Address` (one line), `StreetNumber, StreetName, City, State, ZipCode`, `MLSNumber`,
  `IsListingTransaction`, `ClosingDate`, `TransactionOwnerName`, `LastModified`.
- **Standalone forms** (Forms library → form type → "Create new standalone form"; the other
  choices are "…start a new transaction" and "…add to existing transaction"):
  - Editor URL `/form/{formId}/` (a transaction form's is `/form/{formId}/false`).
  - `GET /api/forms/single/{formId}` → `TransactionID: ""`, `TransactionName: null`.
  - There's no list of their own: each lives inside its form type's folder in
    `GET /api/forms/index` (folder tree, `LoadItemsOnDemand`, `CountOfItems`,
    `ShowBasket: true`). The folder list itself has no Basket; open a form type's folder
    (`/forms/{folderId}`) and each instance has a select circle
    (`ng-click="toggleBasketItem(instance)"`), and the header has a Basket icon.
  - **The Basket is page memory only** (captured 2026-10-11). Ticking makes no request and
    nothing is written to local/session storage. It lives in the Angular service
    `commonSvc.basket.baskets.forms`, an array of `{ID, Name, LastModified, TransactionID,
    TransactionName, Path, IsFinalized, …}`, and it survives moving between folders but not
    a page reload. A MAIN-world script can read it; an isolated content script can't.
  - Downloading the Basket as a zip is the **same two requests** as the deal's forms list
    (`CreateDownloadRequest?type=1` → `downloadmany?token=`), one flattened PDF per form, no
    AcroForm, forms from different folders in one zip. The zip route doesn't care whether a
    form is in a transaction.
- **Values typed into a form** (read-only): `GET /api/formeditor/formfields/{formId}` →
  `FormFieldValues` keyed by WEBForms variable names. On AREA forms the property address
  is `txtp_unitNumber, txtp_streetnum, txtp_street, txtp_city, txtp_state, txtp_zipcode`,
  and the parties are `txtseller1/2`, `txtbuyer1/2`, `txts_broker`/`txtl_broker`. These
  variables give a standalone form an address for the title and deal match, and could
  pre-fill signer names. Field names will vary by form and province, so match loosely and
  never require them.
- "Save as Editable PDF" exists in the form editor; don't use it. Fields stay editable and
  Real Signature renders pages as images anyway. If a PDF arrives with an AcroForm, tell
  the agent to use "Save as PDF" or the zip download.
- Vendor hand-off (`/api/AppsStore/SendItems`) is a server-to-server partner integration
  (DocuSign, Authentisign) and is not something an extension can join.
