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

export class NotSignedIn extends Error {}

export class RealSignature {
  /** getToken: () => string|null (reads document.cookie in the page). */
  constructor({ getToken, fetchImpl = globalThis.fetch.bind(globalThis) }) {
    this.getToken = getToken;
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
    let body;
    if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    if (form) body = form;
    const r = await this.fetch(url.toString(), { method, headers, body });
    if (r.status === 401) throw new NotSignedIn("Real Signature sign-in expired");
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
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

  // ---- reZEN deals, as Real Signature's own picker reads them ----
  openDeals(yentaUserId, { listings = false, searchText, pageNumber = 0, pageSize = 50 } = {}) {
    const kind = listings ? "listing-transactions" : "transactions";
    return this.request("GET", `/transactions/participant/${encodeURIComponent(yentaUserId)}/${kind}/OPEN`,
      { base: ARRAKIS, query: { searchText, pageNumber, pageSize } });
  }
}
