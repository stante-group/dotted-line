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
  { method: "GET", re: /^\/api\/formeditor\/formfields\/[^/]+$/ },          // page count, typed address
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
    const r = await this.fetch(url.toString(), { method, headers, body, credentials: "same-origin" });
    if (r.status === 401) throw new WebFormsSignedOut("WEBForms signed you out — sign in again");
    if (!r.ok) throw new Error(`WEBForms answered ${r.status} to ${method} ${path}`);
    if (binary) return new Uint8Array(await r.arrayBuffer());
    const text = await r.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }

  async userName() {
    const g = await this.request("GET", "/api/systems/GetPopulatedGlobalJson");
    return g && typeof g.UserName === "string" ? g.UserName : null;
  }

  transaction(id) {
    return this.request("GET", `/api/transactions/Basic/${encodeURIComponent(id)}`);
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

/** WEBForms form values → how many buyers and sellers the agent typed in, as counts only
 *  (no names leave the content script). Each side takes the larger of its party lines and
 *  its signature-name lines. A form without these fields → 0s. */
export function partiesFromFormValues(values) {
  const out = {};
  for (const [side, sets] of Object.entries(PARTY_FIELDS)) {
    out[side] = Math.max(...sets.map((keys) => keys.reduce((n, k) => n + peopleOnLine(values?.[k]), 0)));
  }
  return out;
}

/** Pair each picked form with its zip entry by name. Two forms with the same name can't be
 *  told apart in the zip, so that's refused rather than risking swapped contracts. */
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
