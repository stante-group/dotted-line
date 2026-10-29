// TEST COPY ONLY. A stand-in for a WEBForms deal page (dev/webforms.html), so any PDF can go
// through the real hand-off: deal match, one-click, Auto place and a Real Signature draft.
//
// Nothing in src/ or manifest.json refers to this folder (test/dev-guard.test.js fails if
// anything does), and the store zip is manifest + src + icons, so it never ships. Only
// dev/apply.mjs wires it in, and only into the test copy's own files.
//
// What it stands in for is the WEBForms content script's answers (webforms:details and
// webforms:zip) and the panel's read of the ticked forms. Everything from there on is the
// extension's real code. The PDFs stay in this browser (the extension's own IndexedDB)
// until a draft is made, exactly like WEBForms' would.

import { crc32 } from "../src/lib/unzip.js";
import { zipEntryName } from "../src/lib/webforms-api.js";
import { toBase64 } from "../src/lib/pdf.js";

const DB = "devsim";
const STORE = "forms";

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

/** Every form on the page, in the order they were added: {id, name, library, ticked, pages, bytes, order}. */
export async function allForms() {
  const all = await tx("readonly", (s) => s.getAll());
  return all.sort((a, b) => a.order - b.order);
}
export const putForm = (f) => tx("readwrite", (s) => s.put(f));
export const deleteForm = (id) => tx("readwrite", (s) => s.delete(id));

// Invented people only: these end up as a draft's signers.
export const DEFAULT_DEAL = {
  name: "",
  address: "120 Example Street NW",
  city: "",
  mls: "",
  side: "BUYER",
  userName: "",
  userEmail: "",
  buyers: "Jordan Sample, jordan@example.com",
  sellers: "Casey Example, casey@example.com",
};
export async function getDeal() {
  const { devsimDeal } = await chrome.storage.local.get("devsimDeal");
  return { ...DEFAULT_DEAL, ...(devsimDeal || {}) };
}
export const setDeal = (deal) => chrome.storage.local.set({ devsimDeal: deal });

// The tabs showing the test page. Kept by id: without the "tabs" permission Chrome may not
// tell the panel an extension page's address.
export async function addSimTab(tabId) {
  const { devsimTabs = [] } = await chrome.storage.session.get("devsimTabs");
  if (!devsimTabs.includes(tabId)) await chrome.storage.session.set({ devsimTabs: [...devsimTabs, tabId] });
}
export async function isSimTab(tabId) {
  if (tabId == null) return false;
  const { devsimTabs = [] } = await chrome.storage.session.get("devsimTabs").catch(() => ({}));
  return devsimTabs.includes(tabId);
}

/** "First Last, email" per line → {firstName, lastName, email}. */
export function people(text, role) {
  return String(text || "").split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, email = ""] = l.split(",").map((s) => s.trim());
    const words = name.split(/\s+/);
    return { role, firstName: words.length > 1 ? words.slice(0, -1).join(" ") : name, lastName: words.length > 1 ? words.at(-1) : "", email };
  });
}

/** What panel.js readSelection gives on a deal's Forms list. */
export async function selection() {
  const forms = (await allForms()).filter((f) => f.ticked);
  return { source: "deal", transactionId: "devsim", user: null, transaction: null,
    forms: forms.map((f) => ({ id: f.id, name: f.name, transactionId: "devsim", lastModified: null })) };
}

/** What the WEBForms content script answers to webforms:details. */
export async function details({ formIds }) {
  const deal = await getDeal();
  const byId = new Map((await allForms()).map((f) => [f.id, f]));
  const contactPeople = [...people(deal.buyers, "BUYER"), ...people(deal.sellers, "SELLER")];
  const count = (role) => contactPeople.filter((p) => p.role === role).length;
  const address = [deal.address, deal.city].map((s) => s.trim()).filter(Boolean).join(", ");
  return {
    userName: deal.userName.trim() || null,
    userEmail: deal.userEmail.trim() || null,
    transaction: { Name: deal.name.trim() || address, Address: address, StreetNumber: null, StreetName: null,
      City: deal.city.trim() || null, MLSNumber: deal.mls.trim() || null, UnitNumber: null },
    forms: formIds.map((id) => {
      const f = byId.get(id);
      if (!f) throw new Error("A ticked form is gone from the test page. Tick it again.");
      return { id, pageCount: f.pages || null, formGuid: null, library: f.library || null, typeName: null, parties: null };
    }),
    firstFormValues: null,
    parties: { BUYER: count("BUYER"), SELLER: count("SELLER") },
    contactPeople,
    buyerNames: contactPeople.filter((p) => p.role === "BUYER").map((p) => `${p.firstName} ${p.lastName}`.trim()),
    agentSide: deal.side || null,
  };
}

/** The ticked PDFs as WEBForms' download would bring them: one zip, named per form, stored
 *  (not compressed), so the extension's own unzip and pairing run as they do for WEBForms. */
export async function zipFor(forms) {
  const byId = new Map((await allForms()).map((f) => [f.id, f]));
  return toBase64(storedZip(forms.map(({ id, name }) => {
    const f = byId.get(id);
    if (!f) throw new Error(`"${name}" is gone from the test page.`);
    return { name: zipEntryName(name), data: new Uint8Array(f.bytes) };
  })));
}

/** [{name, data}] → a zip with each file stored as is. */
export function storedZip(entries) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const fname = enc.encode(name);
    const crc = crc32(data);
    const head = (sig, central) => {
      const b = new Uint8Array(central ? 46 : 30);
      const v = new DataView(b.buffer);
      v.setUint32(0, sig, true);
      let p = 4;
      if (central) { v.setUint16(p, 20, true); p += 2; }
      v.setUint16(p, 20, true); v.setUint16(p + 2, 0x0800, true); v.setUint16(p + 4, 0, true); // version, UTF-8 names, stored
      v.setUint32(p + 10, crc, true); v.setUint32(p + 14, data.length, true); v.setUint32(p + 18, data.length, true);
      v.setUint16(p + 22, fname.length, true);
      if (central) v.setUint32(42, offset, true);
      return b;
    };
    const local = [head(0x04034b50, false), fname, data];
    centrals.push(head(0x02014b50, true), fname);
    locals.push(...local);
    offset += local.reduce((n, b) => n + b.length, 0);
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true);
  v.setUint32(12, cdSize, true); v.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

/** sendToTab, answering for the test page's tabs and passing everything else through. */
export function wrapSend(send) {
  return async (tabId, msg) => {
    if (!(await isSimTab(tabId))) return send(tabId, msg);
    if (msg?.type === "webforms:details") return details(msg);
    if (msg?.type === "webforms:zip") return { zipBase64: await zipFor(msg.forms) };
    throw new Error(`The test WEBForms page doesn't answer "${msg?.type}".`);
  };
}
