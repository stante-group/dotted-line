// One signer per copy (issue #9). Two or more copies of one form in a packet are usually a
// form that takes one signer, filled once per buyer (or seller). Each copy used to get every
// role — Buyer 1 and Buyer 2 on both — and the agent deleted the extra one per copy by hand.
// With "One signer per copy" ticked in the panel, each copy keeps only its own signer.
//
// A copy given to the wrong person gets signed by the wrong person, so this never guesses:
// who gets which copy is shown before Finish draft, and when the names on the copies don't
// settle it, nothing is split and the panel says why (`refused`).
//
// Slots stay the deal's: copy 2 for the second buyer is that buyer's Buyer 2, not a new
// Buyer 1. A packet's documents name the same person by the same slot, which is how its
// Edit details can show one list of signers. Only that side's other slots come off; the
// agent's own role, and anything else on the copy, is left as it was.

import { formKey } from "./match.js";
import { personName } from "./draft.js";

const SIDES = ["BUYER", "SELLER"];
const word = (side, n = 1) => `${side === "BUYER" ? "buyer" : "seller"}${n === 1 ? "" : "s"}`;
const nth = (k) => `copy ${k + 1}`;

/** The forms ticked more than once: [[i, j, …]] by form index, one list per form type
 *  (formKey: WEBForms' library code, else the form's name). In pick order. */
export function copyGroups(forms) {
  const by = new Map();
  (forms || []).forEach((f, i) => {
    const k = formKey(f);
    by.set(k, [...(by.get(k) || []), i]);
  });
  return [...by.values()].filter((g) => g.length > 1);
}

const tokens = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .split(/[^a-z0-9]+/).filter(Boolean);

/** How many people the copies of one form name between them, per side: two copies each
 *  naming one different buyer name two buyers, though each form alone names one. Without
 *  this the forms' count said 1, so only Buyer 1 went on either copy, and the second
 *  buyer's copy went to the first buyer. Only copies naming exactly one person count;
 *  the same name on both (any word order) is one person. For signerCounts' `webforms`
 *  list, beside each form's own counts. → {BUYER, SELLER} */
export function namedAcrossCopies(forms) {
  const out = { BUYER: 0, SELLER: 0 };
  for (const g of copyGroups(forms)) {
    for (const side of SIDES) {
      const seen = new Set();
      for (const i of g) {
        const f = forms[i];
        if ((f.parties?.[side] || 0) !== 1 || !f.names?.[side]?.length) continue;
        seen.add(tokens(f.names[side].join(" ")).sort().join(" "));
      }
      out[side] = Math.max(out[side], seen.size);
    }
  }
  return out;
}

/** Does a name line typed in WEBForms name this person? Every word of their first and last
 *  name (or the company's name) is on the line, in any order: "Sample, Jordan A." names
 *  Jordan Sample. A person with no name is never matched. */
export function namesPerson(line, p) {
  const want = tokens(personName(p));
  if (!want.length) return false;
  const have = new Set(tokens(line));
  return want.every((t) => have.has(t));
}

/** Who gets which copy, for the panel and for rs:create.
 *  forms: the hand-off's forms ({name, library, parties: {BUYER, SELLER} counts, names:
 *  {BUYER: [lines], SELLER: [lines]}}). people: the signers' source, in reZEN's order (the
 *  deal's participants, or the WEBForms Contacts with no deal) — the same list and order
 *  signeesFromDeal numbers slots from. counts: the panel's Buyers and Sellers.
 *
 *  → {offer, side, by, copies: [{form, slot, line, name}], groups: [{name, copies}], refused}
 *  offer: copies of one form are ticked and more than one person signs on the side, so the
 *  checkbox is worth showing. refused: a sentence saying why nothing is split (then copies
 *  is []). by: "form" (each copy's own buyer or seller line names one person on the deal)
 *  or "order" (no copy names anybody: copy 1 → the side's first person, copy 2 → the
 *  second). line: whose blocks on the copy to keep (see onlySigner); null = this copy's
 *  own slot's, else the first signer's. */
export function oneSignerPlan({ forms, people = [], counts = {} }) {
  const groups = copyGroups(forms);
  const none = { offer: false, side: null, by: null, copies: [], groups: [], refused: null };
  if (!groups.length) return none;
  const sides = SIDES.filter((s) => (counts[s] ?? 0) > 0);
  const refuse = (side, refused) => ({ offer: true, side, by: null, copies: [], groups: [], refused });
  if (sides.length !== 1) {
    // Nobody signing has nothing to split; both sides signing a one-signer form copied
    // per person can't say which side each copy is for.
    if (!sides.length) return none;
    return refuse(null, "Buyers and sellers both sign, so it can't tell whose each copy is. Every copy gets every signer.");
  }
  const side = sides[0];
  const n = counts[side];
  // One person on the side: every copy already has only them.
  if (n < 2) return none;
  const onSide = (people || []).filter((p) => p.role === side).slice(0, n);

  const copies = [];
  const out = [];
  let by = null;
  for (const g of groups) {
    const name = String(forms[g[0]].name || "This form").replace(/\.pdf$/i, "");
    const named = g.map((i) => forms[i].names?.[side] || []);
    const read = g.map((i, k) => Math.max(forms[i].parties?.[side] || 0, named[k].length ? 1 : 0));
    const mine = [];
    if (read.every((r) => r === 0)) {
      // Nothing typed on any copy: in order, which needs exactly as many copies as signers
      // — with fewer, someone would go without a copy and nothing says who.
      if (g.length !== n) {
        return refuse(side, `${g.length} copies of ${name} and ${n} ${word(side, n)}, and the copies don't name anybody, so it can't tell who gets which. Every copy gets every ${word(side)}.`);
      }
      g.forEach((i, k) => mine.push({ form: i, slot: k, line: null, name: onSide[k] ? personName(onSide[k]) : "" }));
      by = by === "form" ? "mixed" : "order";
    } else {
      // Every copy must name exactly one person, and that person must be one of the side's
      // signers, a different one on each copy. Anything else is a guess.
      for (const [k, i] of g.entries()) {
        if (read[k] === 0) return refuse(side, `${name} ${nth(k)} names no ${word(side)} while another copy does. Every copy gets every ${word(side)}.`);
        if (read[k] > 1) return refuse(side, `${name} ${nth(k)} names ${read[k]} ${word(side, 2)}, so it isn't a copy for one. Every copy gets every ${word(side)}.`);
        const line = named[k].join(" ");
        const hits = onSide.map((p, slot) => (named[k].some((l) => namesPerson(l, p)) ? slot : -1)).filter((s) => s >= 0);
        if (hits.length !== 1) {
          const who = onSide.length ? `the ${word(side, 2)} ${onSide.length === 1 ? "is" : "are"} ${onSide.map(personName).filter(Boolean).join(" and ") || "unnamed"}` : `there are no ${word(side, 2)} to match`;
          return refuse(side, hits.length
            ? `${name} ${nth(k)} names "${line}", which matches more than one ${word(side)}. Every copy gets every ${word(side)}.`
            : `${name} ${nth(k)} names "${line}", and ${who}. Every copy gets every ${word(side)}.`);
        }
        const slot = hits[0];
        const twice = mine.find((c) => c.slot === slot);
        if (twice) return refuse(side, `${name} ${nth(g.indexOf(twice.form))} and ${nth(k)} both name ${personName(onSide[slot])}. Every copy gets every ${word(side)}.`);
        // The one person named is on the copy's first line, so the copy's first signer's
        // blocks are theirs.
        mine.push({ form: i, slot, line: 0, name: personName(onSide[slot]) });
      }
      by = by === "order" ? "mixed" : "form";
    }
    copies.push(...mine);
    out.push({ name, copies: mine });
  }
  return { offer: true, side, by, copies, groups: out, refused: null };
}

/** The checkbox's starting state (the agent's own tick or untick always stands). On when
 *  every copy's own lines name a different person on the deal: the agent typed that split
 *  in WEBForms, so this carries their choice over. Off when it would go by order — copies
 *  aren't always for different people, and nothing on them says they are. */
export function oneSignerDefault(plan) {
  return !!plan?.offer && !plan.refused && plan.by === "form";
}

/** A copy's draft body with only its own signer on `side`: that side's blocks for `slot`
 *  kept (or the copy's first signer's moved to `slot`, when the form has a line for one
 *  signer only), every other slot's blocks, validations and signee taken off, and the side's
 *  role cut down to reach `slot`. Other sides and the agent are left alone. a: one of
 *  oneSignerPlan's copies, with its side. → {body, blocks: how many of the side's blocks
 *  the copy kept, hadBlocks: whether it had any to begin with} — some before and none after
 *  is said in the draft-ready notes, so the agent places them. */
export function onlySigner(body, { side, slot, line = null }) {
  const fields = body.fieldDefinitions || [];
  const ofSide = fields.filter((f) => f.signeeType === side);
  const has = (i) => ofSide.some((f) => (f.signeeIndex ?? 0) === i);
  const from = line ?? (has(slot) ? slot : 0);
  const map = new Map();
  const kept = [];
  for (const f of fields) {
    if (f.signeeType === side && (f.signeeIndex ?? 0) !== from) continue;
    map.set(f.index, kept.length);
    kept.push({ ...f, index: kept.length, ...(f.signeeType === side ? { signeeIndex: slot } : {}) });
  }
  const validations = (body.documentFieldValidations || [])
    .filter((v) => map.has(v.fieldIndex)).map((v) => ({ ...v, fieldIndex: map.get(v.fieldIndex) }));
  const configs = (body.signeeConfigs || []).map((c) => (c.signeeType === side ? { ...c, minNum: 0, maxNum: slot + 1 } : c));
  const signees = (body.defaults?.signees || []).filter((s) => s.signeeType !== side || s.signeeIndex === slot);
  return {
    body: { ...body, fieldDefinitions: kept, documentFieldValidations: validations, signeeConfigs: configs,
      defaults: { ...(body.defaults || {}), signees } },
    blocks: kept.filter((f) => f.signeeType === side).length,
    hadBlocks: ofSide.length > 0,
  };
}

/** The panel's lines for the plan: one per copy, "Form, copy 2: Riley Sample (Buyer 2)". */
export function planLines(plan) {
  const w = plan.side === "BUYER" ? "Buyer" : "Seller";
  return plan.groups.flatMap((g) => g.copies.map((c, k) =>
    `${g.name}, ${nth(k)}: ${c.name || "nobody named"} (${w} ${c.slot + 1})`));
}
