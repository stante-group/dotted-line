// Real Signature client — DRAFTS ONLY.
//
// There is deliberately no way to send from here. `POST /documents` (send for signature)
// emails the agent's clients; that stays a human decision in Real Signature's own UI.
// request() refuses those routes even if someone adds a method that calls them, and
// test/realsig-api.test.js fails if one appears.
//
// Runs inside the signature.therealbrokerage.com tab: the API only accepts that origin,
// and the token is the page's own sign-in (cookie `jwtToken`). We read it per request and
// never store it.

export const API = "https://signature-api.therealbrokerage.com/api/v1";
export const ARRAKIS = "https://arrakis.therealbrokerage.com/api/v1";
export const YENTA = "https://yenta.therealbrokerage.com/api/v1";
export const KEYMAKER = "https://keymaker.therealbrokerage.com/api/v1";

const FORBIDDEN = [
  { method: "POST", re: /^\/documents\/?$/ },                    // send
  { method: "POST", re: /\/resend-signature-email$/ },           // re-email signers
  { method: "POST", re: /^\/packets\/?$/ },                      // packet send
  { method: "POST", re: /^\/packets\/[^/]+\/recipients/ },       // add people to a live packet
  { method: "DELETE", re: /^\/documents\// },                    // void a sent document
  { method: "DELETE", re: /^\/packets\// },                      // void a sent packet
  { method: "PUT", re: /^\/documents\/[^/]+\/signees\// },       // edit a live signer
  { method: "PUT", re: /^\/packets\/[^/]+\/signees\// },         // edit a live packet signer
];
// `/packets` are SENT packets (Phase 0 item 4, 2026-10-11). A packet DRAFT is a one-time
// packet TEMPLATE: `POST /packet-templates` — that is what Real's own "create packet" on
// the Draft list calls.

export function isForbidden(method, path) {
  return FORBIDDEN.some((f) => f.method === method.toUpperCase() && f.re.test(path));
}

export function readToken(cookieString) {
  const m = /(?:^|;\s*)jwtToken=([^;]+)/.exec(cookieString || "");
  return m ? decodeURIComponent(m[1]) : null;
}

/** The agent a transaction coordinator picked in Real Signature ("Whose documents would you
 *  like to access?" → "Acting as"). Real's app keeps it in this cookie and sends it back as
 *  the X-Agent-Context header on its API calls (read from its bundle, 2026-10-15). An
 *  agent's own sign-in has no such cookie. */
export function readActingAs(cookieString) {
  const m = /(?:^|;\s*)actingAsUserId=([^;]+)/.exec(cookieString || "");
  const v = m ? decodeURIComponent(m[1]).replace(/^"|"$/g, "") : "";
  return v && v !== "null" && v !== "undefined" ? v : null;
}

export class NotSignedIn extends Error { name = "NotSignedIn"; }

export class RealSignature {
  /** getToken: () => string|null (reads document.cookie in the page).
   *  getActingAs: () => string|null — the agent a TC is acting for, sent as X-Agent-Context. */
  constructor({ getToken, getActingAs = () => null, fetchImpl = globalThis.fetch.bind(globalThis) }) {
    this.getToken = getToken;
    this.getActingAs = getActingAs;
    this.fetch = fetchImpl;
  }

  async request(method, path, { query, json, form, base = API } = {}) {
    if (base === API && isForbidden(method, path)) {
      throw new Error(`refused: ${method} ${path} would send or change a live document`);
    }
    const token = this.getToken();
    if (!token) throw new NotSignedIn("Not signed in to Real Signature");
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined) url.searchParams.set(k, v);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const actingAs = this.getActingAs();
    if (actingAs) headers["X-Agent-Context"] = actingAs;
    let body;
    if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    if (form) body = form;
    const r = await this.fetch(url.toString(), { method, headers, body });
    if (r.status === 401) throw new NotSignedIn("Real Signature sign-in expired");
    if (!r.ok) {
      // A bare "→ 400" can't be diagnosed. Real answers with a problem+json body whose
      // detail/message says which field it refused; keep a short, single-line copy.
      let why = "";
      try {
        const t = await r.text();
        let j = null;
        try { j = JSON.parse(t); } catch { /* not JSON */ }
        // Real wraps it: {"com.real.commons.apierror.ApiError": {message, …}}.
        if (j && typeof j === "object" && Object.keys(j).length === 1 && typeof Object.values(j)[0] === "object") {
          j = Object.values(j)[0];
        }
        why = String((j && (j.detail || j.message || j.error || j.title)) || t || "")
          .replace(/\s+/g, " ").trim().slice(0, 300);
      } catch { /* no body */ }
      throw new Error(`${method} ${path} → ${r.status}${why ? `: ${why}` : ""}`);
    }
    if (r.status === 204) return null;
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }

  // ---- templates (layouts) ----
  listTemplates({ sharedWithMe = false, page = 0, size = 100 } = {}) {
    return this.request("GET", "/document-templates", { query: { sharedWithMe, oneTimeUse: false, page, size } });
  }
  getTemplate(id) { return this.request("GET", `/document-templates/${encodeURIComponent(id)}`); }

  // ---- drafts ----
  /** Upload a PDF as a one-time draft. Nothing is emailed. → {id} */
  uploadDraft(pdfBlob, filename) {
    const form = new FormData();
    form.append("file", pdfBlob, filename);
    return this.request("POST", "/document-templates", { query: { documentType: "USER_PDF", oneTimeUse: true }, form });
  }
  /** Upload a PDF as a new reusable TEMPLATE (a DocuSign import) — the drafts' route with
   *  oneTimeUse false, proven 2026-10-15. Comes back with no blocks and pagesCount null,
   *  like a draft; the PUT below fills it. → {id} */
  uploadTemplate(pdfBlob, filename) {
    const form = new FormData();
    form.append("file", pdfBlob, filename);
    return this.request("POST", "/document-templates", { query: { documentType: "USER_PDF", oneTimeUse: false }, form });
  }
  /** Full replace of a draft (name, signers, blocks, deal). */
  putDraft(id, body) { return this.request("PUT", `/document-templates/${encodeURIComponent(id)}`, { json: body }); }
  /** Clean-up of a draft THIS run created, after a failure. */
  deleteDraft(id) { return this.request("DELETE", `/document-templates/${encodeURIComponent(id)}`); }
  /** Group one-time drafts into one packet draft. They leave the Draft list as separate
   *  rows and show as one packet, opened at /one-time-documents/packet/{id}. → {id} */
  createPacketDraft(name, draftIds) {
    return this.request("POST", "/packet-templates", {
      json: { name, oneTimeUse: true, documentTemplates: draftIds.map((documentTemplateId) => ({ documentTemplateId })) },
    });
  }
  deletePacketDraft(id) { return this.request("DELETE", `/packet-templates/${encodeURIComponent(id)}`); }

  /** Every page of my templates or shared-with-me, up to `max`. Each item already carries
   *  its full fieldDefinitions. */
  async allTemplates({ sharedWithMe = false, max = 500 } = {}) {
    const out = [];
    for (let page = 0; out.length < max; page++) {
      const r = await this.listTemplates({ sharedWithMe, page, size: 100 });
      if (!r || !Array.isArray(r.data)) throw new Error("Real Signature's template list changed shape");
      out.push(...r.data);
      if (r.data.length < 100 || out.length >= (r.totalCount ?? 0)) break;
    }
    return out;
  }

  // ---- who is signed in (the same calls Real Signature's own app makes) ----
  me() { return this.request("GET", "/users/me", { base: YENTA }); }
  async roles() {
    const k = await this.request("GET", "/keymaker/myself", { base: KEYMAKER });
    return (k?.activeRoles || []).map((r) => (typeof r === "string" ? r : r?.role || r?.name)).filter(Boolean);
  }

  // ---- reZEN deals, as Real Signature's own picker reads them ----
  openDeals(yentaUserId, { listings = false, searchText, pageNumber = 0, pageSize = 50 } = {}) {
    const kind = listings ? "listing-transactions" : "transactions";
    return this.request("GET", `/transactions/participant/${encodeURIComponent(yentaUserId)}/${kind}/OPEN`,
      { base: ARRAKIS, query: { searchText, pageNumber, pageSize } });
  }

  // ---- reZEN Buyer Records: since 2026-10-12 every buy-side deal starts as one, so a new
  // buyer's BBA and first offer have no transaction yet. The list has no emails; the
  // detail does (docs/api-notes.md). The same calls reZEN's own Buyers tab makes.
  buyerRecords(ownerId, { pageNumber = 0, pageSize = 50 } = {}) {
    return this.request("GET", "/buyer-record", { base: ARRAKIS,
      query: { pageNumber, pageSize, ownerIds: ownerId, lifecycleStates: "ACTIVE", sortBy: "BBA_START_DATE", sortDirection: "DESC" } });
  }
  buyerRecord(id) { return this.request("GET", `/buyer-record/${encodeURIComponent(id)}`, { base: ARRAKIS }); }

  /** My ACTIVE Buyer Records with their details, newest BBA first, up to `max`. Only
   *  ACTIVE: one In Contract already has its transaction in the OPEN deals. */
  async activeBuyerRecords(ownerId, { max = 40 } = {}) {
    const r = await this.buyerRecords(ownerId, { pageSize: max });
    if (!r || !Array.isArray(r.buyerRecords)) throw new Error("reZEN's Buyer Record list changed shape");
    const out = [];
    for (let i = 0; i < r.buyerRecords.length; i += 5) { // a few at a time, not 40 at once
      out.push(...await Promise.all(r.buyerRecords.slice(i, i + 5).map((b) => this.buyerRecord(b.id))));
    }
    return out;
  }

  /** All OPEN deals or listings I'm a participant on (a TC is on every deal she
   *  coordinates), up to `maxPages` pages. */
  async allOpenDeals(yentaUserId, { listings = false, maxPages = 6 } = {}) {
    const out = [];
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      const r = await this.openDeals(yentaUserId, { listings, pageNumber, pageSize: 50 });
      if (!r || !Array.isArray(r.transactions)) throw new Error("reZEN's deal list changed shape");
      out.push(...r.transactions);
      if (!r.hasNext) break;
    }
    return out;
  }
}
