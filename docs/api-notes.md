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
`/packets`, `/packet-templates/*`, `GET /documents/timezone?transactionId=`,
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
  So the extension can take the app's own bytes by fetching that same URL from the content
  script, or by watching `chrome.downloads` for it — either keeps rule 2 (byte-for-byte).
  Don't trigger the save itself; the agent's own Save/Save-as-PDF does that.
- Multi-form download from the forms list (`CreateDownloadRequest` → `downloadmany`): still
  to capture — one PDF or a zip?
- Vendor hand-off (`/api/AppsStore/SendItems`) is a server-to-server partner integration
  (DocuSign, Authentisign) and is not something an extension can join.
