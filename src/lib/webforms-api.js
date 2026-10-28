// WEBForms client — an ALLOWLIST, not a general client (PLAN rule 2).
//
// The extension may only make requests WEBForms' own pages already make: its zip download
// (the same two requests its button sends) and a few read-only lookups for the title and
// the deal match. Nothing that saves, sends, deletes or moves. request() refuses any other
// route even if a method is added that calls one, and test/webforms-api.test.js checks it.
//
// Runs in the pr.transactiondesk.com tab (content script), so requests are same-origin and
// carry the page's own sign-in: the Bearer token WEBForms keeps in localStorage
// `ls.lastBearer`, read per request and never stored.

const ALLOWED = [
  { method: "GET", re: /^\/api\/systems\/GetPopulatedGlobalJson$/ },        // who's signed in
  { method: "GET", re: /^\/api\/transactions\/Basic\/[^/]+$/ },             // deal name + address
  { method: "GET", re: /^\/api\/transactioncontacts\/index\/[^/]+$/ },      // the deal's Contacts: who's whose agent
  { method: "GET", re: /^\/api\/formeditor\/formfields\/[^/]+$/ },          // page count, typed address
  { method: "GET", re: /^\/api\/forms\/single\/[^/]+$/ },                   // which form type (library code)
  { method: "GET", re: /^\/api\/forms\/index$/ },                           // form types' names (the Forms page's list)
  { method: "POST", re: /^\/api\/Transfer\/CreateDownloadRequest$/ },       // zip, step 1
  { method: "GET", re: /^\/api\/Transfer\/downloadmany$/ },                 // zip, step 2
];

export function isAllowed(method, path) {
  return ALLOWED.some((a) => a.method === method.toUpperCase() && a.re.test(path));
}

/** localStorage `ls.lastBearer` holds the token JSON-quoted. */
export function readBearer(stored) {
  if (!stored) return null;
  try {
    const v = JSON.parse(stored);
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

export class WebFormsSignedOut extends Error {}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WebForms {
  constructor({ getToken, fetchImpl = globalThis.fetch.bind(globalThis), origin = "https://pr.transactiondesk.com" }) {
    this.getToken = getToken;
    this.fetch = fetchImpl;
    this.origin = origin;
  }

  async request(method, path, { query, json, binary = false } = {}) {
    if (!isAllowed(method, path)) throw new Error(`refused: ${method} ${path} isn't a request this extension makes`);
    const token = this.getToken();
    if (!token) throw new WebFormsSignedOut("Sign in to WEBForms first");
    const url = new URL(this.origin + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const headers = { Authorization: `Bearer ${token}` };
    let body;
    if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    // no-store: right after a Save, a cached answer would be the form from before it — a
    // stale title is a nuisance, a stale PDF would be the wrong contract.
    const r = await this.fetch(url.toString(), { method, headers, body, credentials: "same-origin", cache: "no-store" });
    if (r.status === 401) throw new WebFormsSignedOut("WEBForms signed you out — sign in again");
    if (!r.ok) throw new Error(`WEBForms answered ${r.status} to ${method} ${path}`);
    if (binary) return new Uint8Array(await r.arrayBuffer());
    const text = await r.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }

  /** Who WEBForms is working as — the impersonated agent while impersonating. The email
   *  sits only in the page's analytics block (GtmDataLayer…Account.Email); it's used to
   *  tell "same person, name written differently" (Dan / Daniel) from a teammate. */
  async user() {
    const g = await this.request("GET", "/api/systems/GetPopulatedGlobalJson");
    const email = g?.GtmDataLayer?.TransactionDesk?.Account?.Email;
    return {
      name: g && typeof g.UserName === "string" ? g.UserName : null,
      email: typeof email === "string" && email.includes("@") ? email : null,
    };
  }
  async userName() {
    return (await this.user()).name;
  }

  transaction(id) {
    return this.request("GET", `/api/transactions/Basic/${encodeURIComponent(id)}`);
  }
  /** The transaction's Contacts tab: [{TransactionContactTypeName, ContactData.General
   *  {FirstName, LastName, Email, …}, …}] (2026-10-14). */
  contacts(transactionId) {
    return this.request("GET", `/api/transactioncontacts/index/${encodeURIComponent(transactionId)}`);
  }

  /** The form's TYPE, as WEBForms' library code ("AREA0287"), or null. A form's own Name is
   *  not its type: a standalone form gets named after what's typed in it ("120", the civic
   *  number), and its FormGUID is just its own id — so neither can say "this is the
   *  Agreement to Represent Both" (2026-10-12). */
  async formLibrary(formId) {
    const f = await this.request("GET", `/api/forms/single/${encodeURIComponent(formId)}`);
    return f && typeof f.Library === "string" && f.Library.trim() ? f.Library.trim() : null;
  }

  /** {libraryCode: form type name} for every form type in the agent's Forms library. */
  async libraryNames() {
    return libraryNamesFrom(await this.request("GET", "/api/forms/index"));
  }

  /** → {pageCount, formGuid, values} — values = the form's typed-in fields by variable. */
  async formInfo(formId) {
    const f = await this.request("GET", `/api/formeditor/formfields/${encodeURIComponent(formId)}`);
    if (!f || typeof f !== "object") throw new Error("WEBForms' form details changed shape");
    const v = f.FormFieldValues;
    return {
      pageCount: Number.isInteger(f.PageCount) ? f.PageCount : null,
      formGuid: typeof f.FormGUID === "string" ? f.FormGUID : null,
      values: v && typeof v === "object" && !Array.isArray(v) ? v : null,
    };
  }

  /** WEBForms' own "download as zip": forms [{id, name}] → the zip's bytes. */
  async downloadZip(forms) {
    if (!forms.length) throw new Error("no forms picked");
    const t = await this.request("POST", "/api/Transfer/CreateDownloadRequest", {
      query: { type: 1 },
      json: forms.map((f) => ({ Id: f.id, Name: f.name })),
    });
    const token = typeof t === "string" ? t.replace(/"/g, "").trim() : null;
    if (!token || !GUID.test(token)) throw new Error("WEBForms' download request changed shape — not guessing");
    return this.request("GET", "/api/Transfer/downloadmany", { query: { token }, binary: true });
  }
}

/** GET /api/forms/index is the Forms page's folder tree; each form type is a folder whose
 *  `Misc` holds its library code and `Name` its title (checked 2026-10-12, ~650 KB). The
 *  first folder with a code wins — the same type can sit in more than one place. */
export function libraryNamesFrom(tree) {
  const out = {};
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const code = typeof n.Misc === "string" ? n.Misc.trim() : "";
    if (/^[A-Z]{2,}[A-Z0-9_-]*\d$/i.test(code) && typeof n.Name === "string" && n.Name.trim() && !(code in out)) {
      out[code] = n.Name.replace(/\s+/g, " ").trim();
    }
    walk(n.Folders);
  };
  walk(tree);
  return out;
}

/** WEBForms names zip entries `{form name}.pdf` with `/` and `:` replaced by `_`. */
export function zipEntryName(formName) {
  return `${String(formName).replace(/[/:]/g, "_")}.pdf`;
}

// Alberta (AREA) forms hold the parties in txtbuyer1/2 and txtseller1/2, with the names
// under the signature lines in txtbuyersig1/2 and txtsellersig1/2 (checked on 10 forms,
// 2026-10-11). Two lines per side, so a couple often shares one ("Jordan & Riley Sample").
const PARTY_FIELDS = {
  BUYER: [["txtbuyer1", "txtbuyer2"], ["txtbuyersig1", "txtbuyersig2"]],
  SELLER: [["txtseller1", "txtseller2"], ["txtsellersig1", "txtsellersig2"]],
};
const COMPANY = /\b(ltd|limited|inc|incorporated|corp|corporation|company|co|llp|lp|trust|estate)\b\.?/i;

/** How many people one name line holds: 1, plus one per "&" / "and" / "+" — unless it's a
 *  company ("Example Holdings Ltd. and Sons" is one signer). A guess, never authoritative. */
function peopleOnLine(s) {
  const t = String(s ?? "").trim();
  if (!t) return 0;
  if (COMPANY.test(t)) return 1;
  return 1 + (t.match(/&|\+|\band\b/gi) || []).length;
}

// AREA purchase forms carry both brokerages: txtl_* the listing (seller's) side, txts_* the
// selling (buyer's) side, each with an agent name, phone and email (2026-10-14).
const AGENT_EMAIL = { SELLER: "txtl_brkagentemail", BUYER: "txts_brkagentemail" };

/** Which side the WEBForms user is the agent for on this form: "BUYER", "SELLER", "DUAL",
 *  or null (no agent emails on the form, or neither is theirs — a TC's own login, say).
 *  By email only, like samePerson: a team can share a name. While impersonating a
 *  teammate, the email is the teammate's, which is right — it's their file. */
export function agentSideFromFormValues(values, userEmail) {
  const me = String(userEmail ?? "").trim().toLowerCase();
  if (!me) return null;
  const mine = Object.entries(AGENT_EMAIL)
    .filter(([, k]) => String(values?.[k] ?? "").trim().toLowerCase() === me).map(([side]) => side);
  return mine.length === 2 ? "DUAL" : mine[0] ?? null;
}

// The Contacts tab's agent types (GetTxContactTypes, 2026-10-14). In WEBForms' wording the
// "Selling Agent" is the listing side's; the "Buying Agent" the buyer's.
const CONTACT_SIDE = { "buying agent": "BUYER", "selling agent": "SELLER", "listing agent": "SELLER" };

/** One Contacts field as text. Each field arrives as an input description — {InputLabel,
 *  Value, Type, Visible, …} — not a string; String() of that is "[object Object]", which
 *  reached Real Signature as a signer's email and was refused (2026-10-14). */
const field = (v) => String((v && typeof v === "object" ? v.Value : v) ?? "").replace(/\s+/g, " ").trim();

/** Which side the WEBForms user is the agent for, from the transaction's Contacts — the
 *  deal's own record of who's whose agent, so it's read before the forms. By email only.
 *  → "BUYER" / "SELLER" / "DUAL" / null. */
export function agentSideFromContacts(contacts, userEmail) {
  const me = String(userEmail ?? "").trim().toLowerCase();
  if (!me || !Array.isArray(contacts)) return null;
  const sides = new Set();
  for (const c of contacts) {
    const side = CONTACT_SIDE[String(c?.TransactionContactTypeName ?? "").trim().toLowerCase()];
    const g = c?.ContactData?.General || {};
    const emails = [g.Email, g.AlternateEmail].map((e) => field(e).toLowerCase());
    if (side && emails.includes(me)) sides.add(side);
  }
  return sides.size === 2 ? "DUAL" : [...sides][0] ?? null;
}

const contactName = (c) => {
  const g = c?.ContactData?.General || {};
  return [g.FirstName, g.LastName].map(field).filter(Boolean).join(" ")
    || field(g.Company) || field(c?.Name);
};
const contactsOfType = (contacts, type) => (Array.isArray(contacts) ? contacts : [])
  .filter((c) => String(c?.TransactionContactTypeName ?? "").trim().toLowerCase() === type);

/** The transaction's Contacts → {BUYER, SELLER} counts. Contacts are WEBForms' own, the same
 *  in every province, where the form fields (partiesFromFormValues) are AREA's names. */
export function partiesFromContacts(contacts) {
  return { BUYER: contactsOfType(contacts, "buyer").length, SELLER: contactsOfType(contacts, "seller").length };
}

/** The buyers' names from Contacts, for matching a reZEN Buyer Record. */
export function buyerNamesFromContacts(contacts) {
  return contactsOfType(contacts, "buyer").map(contactName).filter(Boolean);
}

/** The Buyer and Seller contacts as signers, in the same shape as a reZEN deal's
 *  participants ({role, firstName, lastName, email}): with no reZEN deal to fill the draft
 *  from, WEBForms' own Contacts can (Dan, 2026-10-14). Email may be blank. */
export function peopleFromContacts(contacts) {
  return [["buyer", "BUYER"], ["seller", "SELLER"]].flatMap(([type, role]) => contactsOfType(contacts, type).map((c) => {
    const g = c?.ContactData?.General || {};
    const first = field(g.FirstName), last = field(g.LastName);
    return { role, firstName: first || (last ? "" : field(g.Company) || field(c?.Name)), lastName: last, email: field(g.Email) };
  }));
}

/** How many buyers and sellers, per side: the Contacts when they list anyone on that side,
 *  else the most any form names. → {BUYER, SELLER} */
export function mergeParties(fromContacts, fromForms) {
  const out = {};
  for (const side of ["BUYER", "SELLER"]) {
    out[side] = fromContacts?.[side] > 0 ? fromContacts[side] : Math.max(0, ...(fromForms || []).map((p) => p?.[side] || 0));
  }
  return out;
}

/** One side for several forms: the forms that say agree, else null. */
export function combineSides(sides) {
  const known = [...new Set(sides.filter(Boolean))];
  return known.length === 1 ? known[0] : null;
}

/** The buyer name lines as typed (party lines, then signature-name lines), for matching a
 *  reZEN Buyer Record by name: a new buyer has no deal and no address to match on yet.
 *  Like the PDFs, they stay in this browser and go no further than the hand-off. */
export function buyerNamesFromFormValues(values) {
  return PARTY_FIELDS.BUYER.flat().map((k) => String(values?.[k] ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** WEBForms form values → how many buyers and sellers the agent typed in, as counts only. Each side takes the larger of its party lines and
 *  its signature-name lines. A form without these fields → 0s. */
export function partiesFromFormValues(values) {
  const out = {};
  for (const [side, sets] of Object.entries(PARTY_FIELDS)) {
    out[side] = Math.max(...sets.map((keys) => keys.reduce((n, k) => n + peopleOnLine(values?.[k]), 0)));
  }
  return out;
}

/** The picked forms split into downloads in which no two share a zip entry name: the first
 *  of each name in the first, the second in the next, and so on. Two copies of one form are
 *  normal (one per signer, when a form takes only one: Dan, 2026-10-28), but the zip names
 *  its files by form name only, so in one download the two can't be told apart. Apart,
 *  each file is its own form's. Almost always one download. → [[form, …], …] in pick order */
export function zipBatches(forms) {
  const batches = [];
  const seen = new Map();
  for (const f of forms) {
    const n = zipEntryName(f.name);
    const k = seen.get(n) || 0;
    seen.set(n, k + 1);
    (batches[k] ||= []).push(f);
  }
  return batches;
}

/** Pair each picked form with its zip entry by name. Two forms with the same name can't be
 *  told apart in one zip, so that's refused rather than risking swapped contracts —
 *  zipBatches() keeps them in separate downloads, so it shouldn't happen. */
export function pairEntries(forms, entries) {
  const byName = new Map();
  for (const e of entries) {
    if (byName.has(e.name)) throw new Error(`The download has two files named "${e.name}". Rename one form in WEBForms and try again.`);
    byName.set(e.name, e);
  }
  const seen = new Set();
  return forms.map((f) => {
    const n = zipEntryName(f.name);
    if (seen.has(n)) throw new Error(`Two of the picked forms are named "${f.name}". Rename one in WEBForms and try again.`);
    seen.add(n);
    const e = byName.get(n);
    if (!e) throw new Error(`"${f.name}" wasn't in WEBForms' download.`);
    return { form: f, data: e.data };
  });
}
