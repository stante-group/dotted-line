// The PUT /document-templates/{id} body for one freshly uploaded draft: name, deal,
// signers, sender, and (if the agent picked one) a template's blocks.

import { applyToDraft } from "./layout.js";

const SIGNER_ROLES = ["BUYER", "SELLER"];

/** reZEN deal participants → how many buyers and sellers. */
export function countsFromDeal(deal) {
  const counts = {};
  for (const role of SIGNER_ROLES) counts[role] = (deal?.participants || []).filter((p) => p.role === role).length;
  return counts;
}

/** reZEN participants → Real Signature signees, Buyer 1 = BUYER/0. Only as many per role as
 *  `counts` allows; everyone signs in parallel (signOrder 1) — the agent can change the
 *  order in Real Signature before sending. */
export function signeesFromDeal(deal, counts) {
  const out = [];
  for (const role of SIGNER_ROLES) {
    const people = (deal?.participants || []).filter((p) => p.role === role).slice(0, counts[role] ?? 0);
    people.forEach((p, i) => out.push({
      signeeType: role,
      signeeIndex: i,
      name: [p.firstName, p.lastName].filter(Boolean).join(" "),
      email: p.email || "",
      signOrder: 1,
    }));
  }
  return out;
}

/** Without a template the draft still needs to say who signs, so Real Signature offers
 *  those signers on its Prepare step. */
function configsFromCounts(counts) {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([signeeType, n]) => ({ signeeType, minNum: n, maxNum: n }));
}

/** draft: GET /document-templates/{id} straight after upload. layout: stripped and
 *  slot-trimmed template, or null. PUT is a FULL replace, so every key the draft had is
 *  carried through. */
export function buildDraftBody({ draft, layout, name, pageCount, transactionId, counts, signees, sender }) {
  const pages = layout?.pagesCount ?? pageCount ?? draft.pagesCount ?? null;
  const base = layout
    ? applyToDraft({ ...draft, pagesCount: pageCount ?? draft.pagesCount }, layout)
    : { ...draft, fieldDefinitions: [], documentFieldValidations: [], signeeConfigs: configsFromCounts(counts) };
  const types = new Set(base.signeeConfigs.map((c) => c.signeeType));
  const prev = draft.defaults || {};
  return {
    ...base,
    name,
    pagesCount: pages,
    defaults: {
      ...prev,
      transactionId: transactionId || null,
      signees: signees.filter((s) => types.has(s.signeeType)),
      recipients: prev.recipients || [],
      sender,
      emailSubject: prev.emailSubject ?? null,
      emailBody: prev.emailBody ?? null,
    },
  };
}
