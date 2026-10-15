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
- Editor URL for a template: `/prepare/{id}` (Upload → Edit details → Prepare → Review).
  For a one-time DRAFT use `/one-time-documents/document/{id}` — what the Drafts pencil
  opens: Transaction → Edit details (signers with names and emails) → Prepare → Review.
  `/prepare/{id}` on a draft skips straight to block placement, and the signers are
  nowhere to be seen (2026-10-12). Packets: `/one-time-documents/packet/{id}`, same steps.
- Many real templates are text-fill only (`STRING`/`SENDER`, no signature blocks). Layout
  reuse only helps where a template actually has SIGNATURE/INITIALS/SIGNED_DATE fields.

### Who is signed in, and a draft's deal (observed 2026-10-11)

- The `jwtToken` cookie is **opaque** (not a dotted JWT); it's only ever used as the Bearer.
- `GET yenta…/api/v1/users/me` → `id` (the yentaUserId for the deal list), `firstName`,
  `lastName`, `fullName`, `emailAddress`, `type` (`AGENT`, …), plus profile fields.
  `GET keymaker…/api/v1/keymaker/myself` → `activeRoles`, … Both are what Real
  Signature's own app calls on load.
- arrakis deal list item (`…/transactions/OPEN` → `{pageNumber, pageSize, hasNext,
  totalCount, transactions[]}`): `id`, `address {street, street2, city, state, zip,
  oneLine}`, `mlsNum`, `transactionOwner {id, name, emailAddress}`, `participants[]
  {id, participantRole, firstName, lastName, emailAddress}`, `participantYentaIds[]`, …
- A draft's deal lives in `defaults`: `{transactionId, signees[] {signeeType, name, email,
  signeeIndex, signOrder}, recipients[], sender {firstName, lastName, email,
  agentYentaId}, emailSubject, emailBody}`. `agentYentaId` was `null` on an agent's own
  draft; it may be how Real records a TC preparing for an agent (Phase 0 item 7).

### Sharing (observed 2026-10-12)

- The app's **Shared** tab is `/shared-with-me/templates`: "Shared with Me" → Templates and
  Folders. It also calls `GET /packet-templates/shared-by-info?name=&page=&size=&sortDirection=&sortBy=`
  → `{data, pageNumber, pageSize, totalCount}`, so packet templates can be shared too.
- Templates shared with you come back from `GET /document-templates?sharedWithMe=true`; the
  panel already lists them, marked "(shared)". Each template's `shareConfigs[]` holds who
  it's shared with (shape not yet seen — none shared in the test account).
- **Reach (Dan, from the share dialog):** your own team, or individual agents anywhere in the
  organisation — nothing wider. So a team lead can give the whole team their templates in
  one step, but another team (or another province's tester) only person by person.
- One-time drafts and packets list via `GET /one-time-templates?page=&size=&sort.dir=&sort.property=`
  (what the Drafts tab calls), not `/document-templates?oneTimeUse=true`, which returns 0.

### Copying a template (done 2026-10-14, on the agent's own template, with permission)

Made a buyer copy of a seller-only template, the way a template import would build one:

1. `POST /document-templates/{id}/clone` (no body) → `201 {id}`. A full copy: same PDF
   (page images present), name, blocks, roles; `oneTimeUse: false`, so it is a template,
   not a draft. The SOURCE's `updatedAt` changed to the clone time; nothing else on it did.
2. `GET` the copy, then `PUT /document-templates/{copyId}` with the whole object back,
   `name` changed and `signeeType` changed on `signeeConfigs[]` and every
   `fieldDefinitions[]` → `204`. Positions, validations and page count came through
   unchanged, and Real's editor (`/prepare/{id}`, Edit details) lists the new roles
   ("Buyer 1", "Buyer 2") with fields assigned.

So a template can be made entirely by API: clone, then one full-replace `PUT` with the
blocks. From a new PDF (a DocuSign import) it would be `POST /document-templates?
documentType=USER_PDF&oneTimeUse=false` then the same `PUT` — the drafts' route with the
flag flipped; untested.

### Real's packet "Add Signees" box pre-fills a wrong row (2026-10-14)

On a PACKET draft, Edit details → **Add Signees** opens a box with one row per role slot.
When a document in the packet already has a signer (the agent, added by Dotted Line as
SELLERS_AGENT), the box copies that signer's NAME — no email — into its FIRST row, whatever
role that row is (a Seller row, there). Reproduced on throwaway packets built by API without
the extension: agent signer on one document → the agent's name in Seller row 1; no signer
anywhere → both rows empty (so not the sender). Single documents don't do it. The saved
data is right (agent as SELLERS_AGENT with email); it's Real's box. Worth reporting to Real;
nothing to change here.

### Edit details → Next deletes roles nobody is assigned to (2026-10-14)

A draft can carry signer roles (signeeConfigs) and their blocks with no one assigned —
Dotted Line does that when a buyer or seller has no email. The API keeps them: PUT and
read back, opening the draft, and Skip on the Transaction step all leave every block. But
clicking **Next** on Edit details deletes every role that has no recipient row, blocks and
signeeConfig both (throwaway draft, agreement-to-represent-both layout: BUYER#0, SELLER#0
and SELLERS_AGENT#0 blocks before; only SELLERS_AGENT after Next). Edit details lists only
named recipients, so the empty Buyer and Seller roles are invisible there and gone a click
later. The agent has to add those signers (Add Another Recipient, with the role) BEFORE
Next; added afterwards, their blocks must be placed by hand.

A PACKET of one document behaves the other way (same layout, throwaway, 2026-10-14):
`POST /packet-templates` takes a single document (200). Its Transaction step lists every
role (Buyer 1, Seller 1, Sellers Agent 1); Edit details says "Number of Signees: 3", keeps
Next greyed out until all are filled, and **Add Signees** has a row per role — the blocks
stay. The packet box's name quirk (above) shows here too: the agent's name lands in the
Buyer row.

### Other routes the app's client has (not yet observed)

`GET /document-templates` (`sharedWithMe`, `oneTimeUse`, `page`, `size`),
`GET /document-templates/{id}`,
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

### Buyer Records (observed 2026-10-14, reZEN's Buyers tab, read only)

Since 2026-10-12 every buy-side and dual deal starts as a reZEN **Buyer Record** (the client
file before contract: buyers, BBA dates, pre-contract documents); "Mark In Contract" turns
it into a transaction. So a new buyer's BBA and first offer have no transaction to attach
to — the OPEN deal lists above don't include them.

- `GET /buyer-record?pageNumber&pageSize&sortDirection&sortBy=BBA_START_DATE&ownerIds={yentaUserId}&lifecycleStates=ACTIVE&lifecycleStates=IN_CONTRACT&lifecycleStates=TERMINATION_REQUESTED`
  → `{pageNumber, pageSize, hasNext, totalCount, buyerRecords[]}`. Each: `id, code,
  lifecycleState, associatedTransaction (null until In Contract), bbaDates {start, end},
  geographicInterest, teamId, teamName, participants[] {id, role, userId, owner, firstName,
  lastName, entityName}` — **no emails in the list**.
- `GET /buyer-record/{id}` → the same plus `participants[] = {internalParticipant,
  externalParticipant}`, one of them null. Internal (agents, TC): `userId, role, owner,
  names`, no email (it's in yenta). External (the clients): `role "BUYER", firstName,
  lastName, emailAddress, phoneNumber, address, entityName, externalParticipantType`.
- Roles seen: `BUYER`, `BUYERS_AGENT`, `TRANSACTION_COORDINATOR`.
- Real Signature's own Transaction step does **not** list Buyer Records (checked
  2026-10-14), so a draft isn't attached to one. Dotted Line fills the buyers in from the
  record and leaves the draft unattached (`BUYER_RECORDS_ATTACH = false` in deals.js).

## WEBForms (`pr.transactiondesk.com`)

- Forms on a deal: `GET /api/transactionforms/index/{transactionId}` →
  `[{ID, Name, Order, IsFinalized, LastModified, …}]`.
- Download: `POST /api/Transfer/CreateDownloadRequest?type=1` with `[{Id, Name}]` → GUID
  token; then `GET /api/Transfer/downloadmany?token=` (single:
  `DownloadSingleWithCriteria?token=`).
- Open form editor `/form/{formId}/{bool}` loads `GET /api/formeditor/formfields/{formId}`
  (`FormGUID`, `PageCount`, …) and `GET /api/forms/single/{formId}` (`LastModified`,
  `Library`, …).
- **A form's type is `Library`** (e.g. `AREA0287`), from `/api/forms/single/{formId}`
  (checked 2026-10-12). Not `FormGUID` — that is the form's own id, the same value as its
  `ID` — and not `Name`: a standalone form is named after what's typed in it (the civic
  number, "120"). The type's title comes from `GET /api/forms/index` (the Forms page's
  folder tree, ~650 KB): each form-type folder has `Misc` = the library code and `Name` =
  the title, e.g. "Agreement to Represent Both Seller and Buyer (Designated Agency)".
- **No auto-save.** Save = `PUT /api/formeditor/saveForm/{formId}` then
  `POST /api/formeditor/saveMarkups/{formId}`. A `beforeunload` guard marks unsaved edits.
- Signed-in user: `GET /api/systems/GetPopulatedGlobalJson` → `UserID`, `UserName`,
  `OfficeID`, `IsBroker`, `Roles`, … (loaded by every page). **Impersonation (checked
  2026-10-12, a team lead impersonating a teammate):** `UserName` is the IMPERSONATED
  agent, and `formfields` and the zip download still work (a full hand-off to Real
  Signature ran while impersonating; the panel matched the teammate's deal and showed the
  others'-deal and different-sign-in notes). So
  `UserName` says whose forms these are — the panel uses it to warn
  ("WEBForms is signed in as X; Real Signature as Y") and to suggest that agent as the
  agent signer. Real Signature has no equivalent: drafts are made in the signed-in Real
  account, which for a team lead already sees teammates' deals.
- The same response's `GtmDataLayer.TransactionDesk.Account.Email` is the account's email
  (the impersonated agent's while impersonating — assumed, not yet seen). "Same person in
  WEBForms and Real" is decided by this email ONLY: names differ between the systems
  ("Dan …" vs "Daniel …") and a family team can share one. No email → "can't confirm",
  shown as a note, never assumed.
- **An open form (2026-10-12):** the editor is at `/form/{id}/false` (bare `/form/{id}` is a
  404 page) under `ng-controller="formEditorCtrl as vm"`. `vm.formObj` → `ID`, `Name`,
  `TransactionID` (empty for standalone), `LastModified` (an empty `0001-01-01` date here);
  `vm.formData` → `FormName`, `FormGUID`, `PageCount`; `vm._editFormId`. WEBForms'
  `window.onbeforeunload` calls a form unsaved when any key of `vm.savedFormFieldValues`
  differs from `vm.formFieldValues`, or `vm.hasUnsavedFieldSettings()`; the model updates a
  moment after typing. `vm.ensureSaved()` / `vm.save()` / `vm.saveForm()` SAVE — never call.
  The Forms library rows (folder view) carry `LastModified` and `DateCreated` per form.
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
  never require them. Purchase forms also carry each side's agent: `txtl_brkagent`,
  `…ph`, `…email` (listing side) and `txts_brkagent…` (selling = buyer's side).
- **Transaction Contacts** (read-only, 2026-10-14): `GET /api/transactioncontacts/index/{txId}`
  → `[{TransactionContactTypeName, ContactTypeClassCode, ContactData: {General: {FirstName,
  LastName, Email, AlternateEmail, Company, AgentID, …}, HomeAddress, WorkAddress, …}, …}]`.
  **Each field is an input description, not a string**: `{InputLabel, Value, Type,
  Visible, Disabled, Required, …}` — read `.Value`. `String()` of the field gives
  "[object Object]", which went to Real Signature as an email once.
  A contact has several names: `FirstName`/`LastName` (read for signers and Buyer Record
  matching), `PreferredName` (what the Contacts list shows, and the top-level `Name`) and
  `PreferredSignature`. Editing Preferred Name alone leaves First/Last unchanged, so the list
  and the signer can disagree. Editing the name on a form updates the contact's names
  together (2026-10-14).
  Types (`GET /api/transactioncontacts/GetTxContactTypes/`, an id → name map): Buyer, Seller,
  Buying Agent, Selling Agent (= listing side), Buying/Selling Broker, lawyers, Landlord,
  Tenant, … The signed-in user's email on a Buying/Selling Agent row says which side they
  represent — read before the form fields, which standalone forms fall back to.
- "Save as Editable PDF" exists in the form editor; don't use it. Fields stay editable and
  Real Signature renders pages as images anyway. If a PDF arrives with an AcroForm, tell
  the agent to use "Save as PDF" or the zip download.
- Vendor hand-off (`/api/AppsStore/SendItems`) is a server-to-server partner integration
  (DocuSign, Authentisign) and is not something an extension can join.
