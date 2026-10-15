// One click (Dan, 2026-10-14: "as close to one click to a Real Signature draft as
// possible"). When nothing the Real Signature panel would ask needs a person, the draft is
// made straight from the WEBForms popup and the agent lands on it. The draft page itself is
// the review — it shows the deal, the signers and the blocks — and nothing is sent.
//
// "Nothing needs a person" means the panel would have pre-filled every choice the same way
// and shown no warning: one deal clearly matches the address, every form has a remembered
// template that still fits (or there are no templates to choose from), and none of the
// notes the panel shows as warnings applies. Anything else goes to the panel, with why.

import { rankDeals, matchesBuyerNames } from "./deals.js";
import { suggestTemplate, signingSide } from "./match.js";
import { signerCounts, signersWithoutEmail } from "./draft.js";
import { actingNotes } from "./actor.js";

/** Below this, or with a tie at the top, the agent picks the deal. */
export const CONFIDENT = 0.75;

/** Every deal, best match first, and the one to pre-select (or null), with how it was
 *  matched: "address", or "name" for a Buyer Record (no property yet, so only the buyers'
 *  names typed in WEBForms can find it — and only when exactly one record matches). */
export function confidentDeal(address, deals, buyerNames = []) {
  const ranked = address ? rankDeals(address, deals.filter((d) => d.kind !== "buyer")) : deals.filter((d) => d.kind !== "buyer").map((deal) => ({ deal, score: 0 }));
  const [a, b] = ranked;
  const records = deals.filter((d) => d.kind === "buyer");
  const named = buyerNames.length ? records.filter((d) => matchesBuyerNames(buyerNames, d)) : [];
  // Buyer Records go first when the names match, then the rest of them at the end.
  const all = [...named.map((deal) => ({ deal, score: 1 })), ...ranked,
    ...records.filter((d) => !named.includes(d)).map((deal) => ({ deal, score: 0 }))];
  if (a && a.score >= CONFIDENT && !(b && b.score === a.score)) {
    return { ranked: [a, ...all.filter((x) => x.deal !== a.deal)], deal: a.deal, by: "address" };
  }
  if (named.length === 1) return { ranked: all, deal: named[0], by: "name" };
  return { ranked: all, deal: null, by: null };
}

/** Templates that can help a form: same page count AND at least one signature, initial or
 *  date block. Agents who rarely use Real Signature have many text-only templates. */
export function usableTemplates(form, templates) {
  return templates.filter((t) => t.blocks > 0 && form.pageCount && t.pagesCount === form.pageCount);
}

/** job: the hand-off without PDFs. c: rs:context's answer. → {ready, needs: [why], and the
 *  rs:create choices: dealId, templateIds (null = no template), counts, agentChoice}. */
export function planDraft({ job, c, remembered = {}, agentMode = "one" }) {
  const needs = [];
  const { deal } = confidentDeal(job.address, c.deals, job.buyerNames);
  if (!deal) {
    needs.push(job.address
      ? "No reZEN deal or Buyer Record clearly matches — choose one (or No deal)."
      : "No address or buyer name to match a reZEN deal with — choose one (or No deal).");
  }

  // Templates are remembered per side, and one with blocks only for the side that isn't
  // signing would place none — so the side is settled first (signingSide).
  const side = signingSide({ deal, agentSide: job.agentSide });
  const templateIds = job.forms.map((form) => {
    const usable = usableTemplates(form, c.templates);
    if (!usable.length) return null; // nothing to choose: blocks are placed in Real Signature
    const s = suggestTemplate(form, usable, remembered, side);
    if (s.remembered) return s.remembered.id;
    const refused = suggestTemplate(form, c.templates, remembered, side).refused;
    needs.push(!refused ? `${form.name}: choose a template once — it's remembered after that.`
      : refused.kind === "side" ? `${form.name}: your usual template isn't used — ${refused.reason}.`
      : `${form.name}: your usual template no longer fits (${refused.reason}).`);
    return null;
  });

  const picked = templateIds.map((id) => c.templates.find((t) => t.id === id)).filter(Boolean);
  const { counts } = signerCounts({
    deal, formNames: job.forms.map((f) => f.name),
    templates: picked.map((t) => t.slots).filter(Boolean),
    webforms: job.parties ? [job.parties] : job.forms.map((f) => f.parties).filter(Boolean),
    agentSide: job.agentSide,
  });

  if (deal) {
    // The panel's warnings, each of which wants a look before the draft exists.
    for (const n of actingNotes({ me: c.me, deal, webformsUserName: job.webformsUserName, webformsUserEmail: job.webformsUserEmail })) {
      if (n.level === "warn") needs.push(n.text);
    }
    if (signersWithoutEmail(deal, counts).length) needs.push("A client on this deal has no email in reZEN.");
  }

  // Same default as the panel's box: the agent signs when a picked template has agent blocks.
  const agentOn = picked.some((t) => t.agentRole);
  return {
    ready: needs.length === 0,
    needs,
    dealId: deal?.id ?? null,
    templateIds,
    counts,
    agentChoice: agentOn ? (agentMode === "all" ? "all" : "best") : null,
  };
}
