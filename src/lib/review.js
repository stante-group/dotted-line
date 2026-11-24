// "Check before you send" (Dan's plan, 0.4.0): on Real Signature's Review step, what is
// missing from the document or packet the agent is about to send. It only reports — it
// never blocks Send and never changes the document; the agent fixes things in Real
// Signature itself (Add Signees, Prepare) and presses Send there.
//
// Three things, the ones that come back as a call from a client or a broker:
//   - a signer with no email (Real can't send them anything), or one that isn't an email;
//   - a signer with no signature block (they'd get a document with nothing to sign);
//   - a signature with no date beside it.
// And two that make the first three meaningless: nobody set to sign at all, and signature
// blocks for a role nobody is in (Buyer 2's blocks with no Buyer 2).
//
// Pure: it reads a draft as GET /document-templates/{id} returns it (or a packet as
// GET /packet-templates/{id}), and returns plain items. The panel says them in words.

import { AGENT_ROLES } from "./draft.js";

const SIGNATURE = "SIGNATURE";
// Real's two stamps that carry the date: Date & Time and Signed Date (api-notes "Values").
const DATES = new Set(["SIGNED_DATE", "SIGNED_DATE_ONLY"]);
// Deliberately loose: something@something.something. Real checks its own way when it sends;
// this only catches a name typed in the email box, or an email cut short.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Real Signature's own name for a slot, as its Transaction step lists them:
 *  "Buyer 1", "Seller 2", "Sellers Agent 1". */
export function slotName(signeeType, signeeIndex = 0) {
  const words = String(signeeType || "Signer").toLowerCase().split("_").filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return `${words} ${(signeeIndex ?? 0) + 1}`;
}

const slotKey = (t, i) => `${t}#${i ?? 0}`;
const shapeError = () => new Error("Real Signature's draft changed shape");

/** One document's signers (in roles it has, as ondraft.js draftSigners counts them) and
 *  its blocks, checked for shape: a draft that doesn't look like one throws, never guesses. */
function readDocument(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.fieldDefinitions)) throw shapeError();
  const signees = doc.defaults?.signees ?? [];
  if (!Array.isArray(signees)) throw shapeError();
  for (const s of signees) if (!s || typeof s.signeeType !== "string") throw shapeError();
  for (const f of doc.fieldDefinitions) if (!f || typeof f.type !== "string") throw shapeError();
  // Real leaves a packet's documents carrying signers in roles they don't have (ondraft.js
  // draftSigners): Real's screens hide them, and so does this check.
  const roles = new Set((doc.signeeConfigs || []).map((c) => c?.signeeType));
  const signers = signees.filter((s) => !roles.size || roles.has(s.signeeType));
  return { name: String(doc.name || "Document"), signers, fields: doc.fieldDefinitions };
}

const mine = (fields, s) => fields.filter((f) => f.signeeType === s.signeeType && (f.signeeIndex ?? 0) === (s.signeeIndex ?? 0));
const pages = (f) => (f.fieldLocations || []).map((l) => l?.pageNum);

/** Signatures of signer s with no date block on the same page. A date counts if it is the
 *  signer's own, or the same side's Signer 1's: one "Signed and dated at ___ on ___" line
 *  above several lines is Buyer 1's date in Dotted Line's own placement (autoplace.js), and
 *  forms share it. Same page, not "beside": a date set apart from its line by a paragraph
 *  is still that signature's date, and a false alarm here trains the agent to ignore it. */
function undated(fields, s) {
  const datedPages = new Set(fields
    .filter((f) => DATES.has(f.type) && f.signeeType === s.signeeType
      && ((f.signeeIndex ?? 0) === (s.signeeIndex ?? 0) || (f.signeeIndex ?? 0) === 0))
    .flatMap(pages));
  return mine(fields, s).filter((f) => f.type === SIGNATURE && !pages(f).some((p) => datedPages.has(p))).length;
}

/** Roles with a signature block and nobody in them: "Buyer 2" blocks, no Buyer 2. */
function orphanSlots(fields, signers) {
  const named = new Set(signers.map((s) => slotKey(s.signeeType, s.signeeIndex)));
  const out = new Map();
  for (const f of fields) {
    if (f.type !== SIGNATURE || !f.signeeType) continue;
    // SENDER blocks are the sender's own and filled by Real, never a signer to add.
    if (f.signeeType === "SENDER") continue;
    const k = slotKey(f.signeeType, f.signeeIndex);
    if (!named.has(k)) out.set(k, { signeeType: f.signeeType, signeeIndex: f.signeeIndex ?? 0 });
  }
  return [...out.values()];
}

const who = (s) => ({ slot: slotName(s.signeeType, s.signeeIndex), name: String(s.name || "").trim() || null,
  agent: AGENT_ROLES.includes(s.signeeType) });

function emailItems(signers) {
  const items = [], seen = new Set();
  for (const s of signers) {
    const k = slotKey(s.signeeType, s.signeeIndex);
    if (seen.has(k)) continue;
    seen.add(k);
    const email = String(s.email ?? "").trim();
    if (!email) items.push({ kind: "no-email", ...who(s) });
    else if (!EMAIL.test(email)) items.push({ kind: "bad-email", ...who(s) });
  }
  return items;
}

/** What's missing on one document, on its Review step. → {ready, items, packet: false}
 *  items: [{kind, slot, name, count?, doc?}], kind one of
 *  "no-signers", "in-packet", "no-email", "bad-email", "no-signature", "undated", "no-signer". */
export function checkDocument(doc) {
  const d = readDocument(doc);
  const items = [];
  // Real won't send a packet's document on its own (api-notes, 2026-10-30): say so first.
  if (doc.oneTimeUsePacket === true) items.push({ kind: "in-packet" });
  if (!d.signers.length) items.push({ kind: "no-signers" });
  items.push(...emailItems(d.signers));
  for (const s of d.signers) {
    if (!mine(d.fields, s).some((f) => f.type === SIGNATURE)) items.push({ kind: "no-signature", ...who(s) });
    const n = undated(d.fields, s);
    if (n) items.push({ kind: "undated", ...who(s), count: n });
  }
  for (const o of orphanSlots(d.fields, d.signers)) items.push({ kind: "no-signer", slot: slotName(o.signeeType, o.signeeIndex), name: null });
  return { ready: !items.length, items, packet: false };
}

/** What's missing on a packet: the same, across its documents. Real saves the packet's
 *  signers on every document (api-notes, 2026-10-30), so a signer counts as having a
 *  signature block if ANY document has one for them — the agent signs one document of four,
 *  and the other three aren't "missing" his signature. Dates and orphan blocks are per
 *  document, and say which. */
export function checkPacket(packet) {
  if (!packet || !Array.isArray(packet.documentTemplates)) throw new Error("Real Signature's packet changed shape");
  const docs = packet.documentTemplates.map(readDocument);
  const items = [];
  if (!docs.length) return { ready: false, items: [{ kind: "no-signers" }], packet: true };
  const all = docs.flatMap((d) => d.signers);
  if (!all.length) items.push({ kind: "no-signers" });
  items.push(...emailItems(all));
  const signed = new Set(docs.flatMap((d) => d.signers.filter((s) => mine(d.fields, s).some((f) => f.type === SIGNATURE))
    .map((s) => slotKey(s.signeeType, s.signeeIndex))));
  const seen = new Set();
  for (const s of all) {
    const k = slotKey(s.signeeType, s.signeeIndex);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!signed.has(k)) items.push({ kind: "no-signature", ...who(s) });
  }
  const many = docs.length > 1;
  for (const d of docs) {
    for (const s of d.signers) {
      const n = undated(d.fields, s);
      if (n) items.push({ kind: "undated", ...who(s), count: n, doc: many ? d.name : null });
    }
    for (const o of orphanSlots(d.fields, d.signers)) {
      items.push({ kind: "no-signer", slot: slotName(o.signeeType, o.signeeIndex), name: null, doc: many ? d.name : null });
    }
  }
  return { ready: !items.length, items, packet: true };
}

/** The check in plain words, one sentence per item, in Real Signature's words (Add
 *  Signees, Prepare). The signer's name is shown in the panel only; it never goes in a
 *  report (report.js has no field for it). */
export function reviewLines(result) {
  const thing = result?.packet ? "packet" : "document";
  return (result?.items || []).map((i) => {
    const w = i.name ? `${i.slot} (${i.name})` : i.slot;
    const on = i.doc ? ` on ${i.doc}` : "";
    switch (i.kind) {
      case "in-packet": return "This document is in a packet: send it from the packet (the Draft tab → the packet's Edit), not from here.";
      case "no-signers": return `Nobody is set to sign this ${thing} yet. Add who signs in Edit details.`;
      case "no-email": return `${w} has no email. Add it in Add Signees.`;
      case "bad-email": return `${w}'s email doesn't look like an email. Check it in Add Signees.`;
      case "no-signature": return `${w} has no signature block${result.packet ? " on any document" : ""}. Add one on Prepare, or take ${i.agent ? "the agent" : "them"} off in Add Signees if they don't sign.`;
      case "undated": return `${w}'s signature${i.count > 1 ? `s (${i.count})` : ""}${on} ${i.count > 1 ? "have" : "has"} no date block on the same page. Add a date on Prepare if the form asks for one.`;
      case "no-signer": return `${w}${on} has a signature block but nobody to sign it. Add them in Add Signees, or take the block off on Prepare.`;
      default: return "Something on this draft couldn't be checked.";
    }
  });
}

/** The toolbar icon's tooltip, for a check the agent can't see because the panel is shut. */
export function reviewTitle(result, { error = false } = {}) {
  if (error) return "Dotted Line couldn't check this before you send. Click to see why.";
  const n = result?.items?.length || 0;
  if (!n) return null;
  return `Dotted Line: ${n} thing${n > 1 ? "s" : ""} to check before you send. Click to see ${n > 1 ? "them" : "it"}.`;
}
