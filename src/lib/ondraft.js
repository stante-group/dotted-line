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
 *  null: Edit details hasn't been saved yet, so nobody is named. */
export function draftSigners(draft) {
  const signees = draft?.defaults?.signees;
  if (!Array.isArray(signees) || !signees.length) return null;
  const counts = {};
  for (const s of signees) {
    if (!s?.signeeType) throw new Error("Real Signature's draft signers changed shape");
    counts[s.signeeType] = Math.max(counts[s.signeeType] || 0, (s.signeeIndex ?? 0) + 1);
  }
  const agents = AGENT_ROLES.filter((r) => counts[r]);
  return { counts, agentRole: agents.length === 2 ? "both" : agents[0] || null, total: signees.length };
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
export function placeOnDraft(draft, found, pageCount) {
  const who = draftSigners(draft);
  if (!who) throw new Error("no signers yet");
  const old = draft.fieldDefinitions || [];
  let layout = found ? forClients(found, who.counts) : null;
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
