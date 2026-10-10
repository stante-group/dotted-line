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
- **Auth:** requests from our own script got 401 even via the page's `$http`; the app's own
  HTTP service adds a token. Header name: **unknown (Phase 0)**.
- Vendor hand-off (`/api/AppsStore/SendItems`) is a server-to-server partner integration
  (DocuSign, Authentisign) and is not something an extension can join.
