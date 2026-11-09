// Auto place on a draft the agent made in Real Signature itself (its one-time upload), not
// from WEBForms: an offer from another agent, say. Real Signature has already done the
// deal and the signers — Edit details' Next saves defaults.signees and signeeConfigs
// (observed 2026-10-30) — so Dotted Line adds only the blocks, on the Prepare step.
//
// Who signs comes from the draft's own signers, never from a guess: a role nobody is in
// gets no blocks, the way dropUnusedSlots treats a missing Buyer 2. Blocks already on the
// draft stay; a placed block that lands on one of them is left out, so pressing Auto place
// twice doesn't double anything.

import { forAgent, forClients } from "./autoplace.js";
import { AGENT_ROLES } from "./draft.js";

/** The draft's signers as counts per signeeType (highest slot + 1), and the agent's role:
 *  the one agent type among them, "both" for a dual agent, or null when no agent signs.
 *  null: Edit details hasn't been saved yet, so nobody is named.
 *  Only signers in a role the document HAS (its signeeConfigs) count. Real rewrites every
 *  document of a packet when one is added or removed, and leaves the others carrying all
 *  the packet's signers: a buyer from a removed lease document sat on four seller
 *  documents, hidden on Real's screens, and Auto place gave them buyer blocks (Dan,
 *  2026-10-31). stray: how many signers are in a role the document doesn't have. */
export function draftSigners(draft) {
  const signees = draft?.defaults?.signees;
  if (!Array.isArray(signees) || !signees.length) return null;
  const roles = new Set((draft.signeeConfigs || []).map((c) => c?.signeeType));
  const counts = {};
  let stray = 0;
  for (const s of signees) {
    if (!s?.signeeType) throw new Error("Real Signature's draft signers changed shape");
    if (roles.size && !roles.has(s.signeeType)) { stray++; continue; }
    counts[s.signeeType] = Math.max(counts[s.signeeType] || 0, (s.signeeIndex ?? 0) + 1);
  }
  if (!Object.keys(counts).length) return null;
  const agents = AGENT_ROLES.filter((r) => counts[r]);
  return { counts, agentRole: agents.length === 2 ? "both" : agents[0] || null, total: signees.length - stray, stray };
}

/** The Drafts list's rows → uploads nobody has set up yet: single documents (not packets)
 *  with nobody named, made in the last week, newest five. */
export function newUploads(rows, now = Date.now()) {
  const week = now - 7 * 24 * 3600 * 1000;
  return (rows || [])
    .filter((d) => d?.type === "DOCUMENT" && typeof d.id === "string" && !d.defaults?.signees?.length && (d.createdAt ?? 0) >= week)
    .slice(0, 5)
    .map((d) => ({ id: d.id, name: String(d.name || "Draft"), createdAt: d.createdAt }));
}

// The kinds of field that are a signer's block (not a text box or a check box).
export const BLOCK_TYPES = new Set(["SIGNATURE", "INITIALS", "SIGNED_DATE", "SIGNED_DATE_ONLY", "SIGNED_TIME_ONLY"]);
export const blockCount = (t) => (t?.fieldDefinitions || []).filter((f) => BLOCK_TYPES.has(f?.type)).length;

/** A document nobody has set up: no signers named in a role it has, and no blocks. The one
 *  rule for a single upload's Set up and a packet's (content.js packetRead): a document
 *  with either is the agent's work, and Set up's full save would lose it. */
export const notSetUp = (doc) => !draftSigners(doc) && !blockCount(doc);

const WEEK = 7 * 24 * 3600 * 1000;

/** The Drafts list's rows → the packets to look inside, newest five from the last week.
 *  The list holds single documents (type "DOCUMENT") and packets; the packet row's own
 *  type word hasn't been seen (docs/api-notes.md), so every other row is taken as a packet
 *  and checked by reading it (unsetPacket). A row with no id or date throws: the list
 *  changed, and guessing would list the wrong things. */
export function packetRows(rows, now = Date.now()) {
  const out = [];
  for (const d of rows || []) {
    if (d?.type === "DOCUMENT") continue;
    if (typeof d?.id !== "string" || !d.id || typeof d.createdAt !== "number") throw new Error("Real Signature's draft list changed shape: a packet has no id or date");
    if (d.createdAt >= now - WEEK) out.push({ id: d.id, name: String(d.name || "Packet"), createdAt: d.createdAt });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
}

/** A packet read whole (GET /packet-templates/{id}) → a row for the home page's list when
 *  any of its documents isn't set up, else null. Partly set-up packets count: the packet's
 *  own Set up (panel openPacket) sets up only the fresh documents and leaves the others as
 *  they are. row: its Drafts list row, for the name and date. */
export function unsetPacket(p, row) {
  if (!p || typeof p !== "object" || !Array.isArray(p.documentTemplates)) throw new Error("Real Signature's packet changed shape");
  if (p.id != null && p.id !== row.id) throw new Error("Real Signature's packet changed shape: it came back with another id");
  if (p.oneTimeUse === false) return null; // a reusable packet, not a draft
  const docs = p.documentTemplates;
  if (docs.some((d) => !d || typeof d !== "object")) throw new Error("Real Signature's packet changed shape");
  const unset = docs.filter(notSetUp).length;
  if (!unset) return null;
  return { kind: "packet", id: row.id, name: String(p.name || row.name || "Packet"), createdAt: row.createdAt, documents: docs.length, unset };
}

/** "5 minutes ago", from a time in milliseconds. */
export function agoWords(t, now = Date.now()) {
  const m = Math.max(0, Math.round((now - (t || 0)) / 60000));
  const n = (v, w) => `${v} ${w}${v === 1 ? "" : "s"} ago`;
  return m < 1 ? "just now" : m < 60 ? n(m, "minute") : m < 1440 ? n(Math.round(m / 60), "hour") : n(Math.round(m / 1440), "day");
}

/** The home page's list: single uploads and packets together, newest first, each with its
 *  second line. A packet's date is when its documents were combined, so "Made", not
 *  "Uploaded"; a partly set-up one says how many are left. */
export function homeList(uploads = [], packets = [], now = Date.now()) {
  const s = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [
    ...uploads.map((d) => ({ ...d, kind: "document", detail: `Uploaded ${agoWords(d.createdAt, now)}` })),
    ...packets.map((p) => ({ ...p, detail: `${p.unset < p.documents ? `Packet, ${p.unset} of ${p.documents} documents not set up` : `Packet of ${s(p.documents, "document")}`} · Made ${agoWords(p.createdAt, now)}` })),
  ].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

const area = (p) => Math.max(0, p[2] - p[0]) * Math.max(0, p[3] - p[1]);

/** Two blocks on the same spot: same page, and they share over half the smaller one. */
export function sameSpot(a, b) {
  return (a.fieldLocations || []).some((la) => (b.fieldLocations || []).some((lb) => {
    if (la.pageNum !== lb.pageNum) return false;
    const [p, q] = [la.position, lb.position];
    const inter = area([Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.min(p[2], q[2]), Math.min(p[3], q[3])]);
    return inter > 0.5 * Math.min(area(p), area(q));
  }));
}

/** The PUT body for the draft with placed blocks added. found: autoLayout(...).layout (or
 *  null), pageCount: the PDF's pages. PUT is a full replace, so everything the draft had —
 *  signers, deal, email, its own blocks — goes back as it was.
 *  → {body, added, skipped} (skipped: placed on a spot that already had a block). */
// side: "BUYER" or "SELLER", the agent's answer to whose a client line is. A form that says
// only "client" (BCFSA's Disclosure of Remuneration: "person(s) to whom the disclosure is
// made") on a draft with buyers AND sellers can't be told apart, so → {needSide: true} and
// nothing is placed until the agent says (Dan's test, 2026-10-30).
export function placeOnDraft(draft, found, pageCount, side = null) {
  const who = draftSigners(draft);
  if (!who) throw new Error("no signers yet");
  const old = draft.fieldDefinitions || [];
  const both = who.counts.BUYER > 0 && who.counts.SELLER > 0;
  if (both && !side && found?.fieldDefinitions?.some((f) => f.signeeType === "CLIENT")) return { needSide: true };
  const clients = both && side ? { ...who.counts, [side === "BUYER" ? "SELLER" : "BUYER"]: 0 } : who.counts;
  let layout = found ? forClients(found, clients) : null;
  // The generic "Brokerage Representative" lines: the agent's, when one agent signs. A dual
  // agent can't be told apart on them, so they come off; each side's own lines stay.
  if (layout && who.agentRole !== "both") layout = forAgent(layout, who.agentRole);
  const placed = (layout?.fieldDefinitions || [])
    .filter((f) => f.signeeType !== "AGENT" && (f.signeeIndex ?? 0) < (who.counts[f.signeeType] || 0));
  const fresh = placed.filter((f) => !old.some((o) => sameSpot(o, f)));
  const base = old.reduce((m, f) => Math.max(m, (f.index ?? -1) + 1), 0);
  const index = new Map(fresh.map((f, i) => [f.index, base + i]));
  const vals = (layout?.documentFieldValidations || [])
    .filter((v) => index.has(v.fieldIndex)).map((v) => ({ ...v, fieldIndex: index.get(v.fieldIndex) }));
  return {
    body: {
      ...draft,
      pagesCount: draft.pagesCount ?? pageCount ?? null,
      fieldDefinitions: [...old, ...fresh.map((f) => ({ ...f, index: index.get(f.index) }))],
      documentFieldValidations: [...(draft.documentFieldValidations || []), ...vals],
    },
    added: fresh.length,
    skipped: placed.length - fresh.length,
  };
}

// Why a document got no blocks, in a few words, for a packet's summary line.
const WHY_NONE = {
  "no-text": "is a scan with no text to read",
  fonts: "has text that can't be read as words",
  "no-labels": "has no signature lines Dotted Line knows",
  "pdf-locked": "is locked",
  "pdf-unreadable": "couldn't be read",
};

/** Auto place on a packet, said document by document (Dan, 2026-10-31: one document with
 *  no signature lines made the whole packet read "No signature lines … on this form",
 *  though the other three already had every block). results: [{name, added, skipped,
 *  outcome}]. → {text, level: "ok" | "warn"} */
export function packetPlacedSummary(results) {
  const added = results.reduce((n, r) => n + r.added, 0);
  const full = results.filter((r) => !r.added && r.skipped);
  const none = results.filter((r) => !r.added && !r.skipped);
  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const parts = [];
  if (added) parts.push(`Placed ${n(added, "block")} on ${n(results.filter((r) => r.added).length, "document")}.`);
  if (full.length) parts.push(full.length === results.length ? "Every block Dotted Line would place is already on this packet."
    : `${n(full.length, "document")} already ${full.length === 1 ? "has" : "have"} every block Dotted Line would place.`);
  // Lines a document had that nobody could be given (a customer form naming no side).
  const notes = results.filter((r) => r.note).map((r) => `${r.name}: ${r.note}`);
  for (const r of none) {
    parts.push(r.outcome ? `${r.name} ${WHY_NONE[r.outcome] || "got no blocks"}: place its blocks in Real Signature if it needs any.`
      : `${r.name}: its signature lines are for signers who aren't on it. Check Edit details.`);
  }
  parts.push(...notes);
  return { text: parts.join(" "), level: added && !notes.length ? "ok" : "warn" };
}

/** A packet's documents on different reZEN deals (Dan, 2026-10-31: a lease document made
 *  from another deal, added to a seller's packet). Real sends a packet to everyone on it,
 *  so one deal's clients would get the other deal's documents. Real allows it; the panel
 *  says so. docs: [{name, transactionId}]. → {deal: the one most documents share (the
 *  first such, on a tie) or null, odd: the names of documents on another deal} */
export function packetDeals(docs) {
  const tally = new Map();
  for (const d of docs) if (d.transactionId) tally.set(d.transactionId, (tally.get(d.transactionId) || 0) + 1);
  let deal = null;
  for (const [id, n] of tally) if (!deal || n > tally.get(deal)) deal = id;
  return { deal, odd: docs.filter((d) => d.transactionId && d.transactionId !== deal).map((d) => d.name) };
}

/** The warning for packetDeals' odd documents, or null. */
export function mixedDealsWarning(odd) {
  if (!odd.length) return null;
  const list = odd.length === 1 ? odd[0] : `${odd.slice(0, -1).join(", ")} and ${odd.at(-1)}`;
  return `${list} ${odd.length === 1 ? "is" : "are"} on a different reZEN deal from the rest of this packet. Everyone on the packet gets every document in it: check this is meant before you send.`;
}

/** The warning for documents carrying signers in a role they don't have (draftSigners'
 *  stray), or null. docs: [{name, stray}]. */
export function straySignersWarning(docs) {
  const odd = docs.filter((d) => d.stray);
  if (!odd.length) return null;
  const list = odd.length === 1 ? odd[0].name : `${odd.length} documents`;
  return `${list} ${odd.length === 1 ? "has" : "have"} a signer saved in a role ${odd.length === 1 ? "it doesn't" : "they don't"} have, left from a document added to or removed from this packet. Real Signature doesn't show them on Edit details, and Dotted Line places nothing for them. Check Add Signees on Review before you send.`;
}
