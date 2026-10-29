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
  // Nothing even close: no deal with the civic number AND a street word in common (above
  // 0.5, see addressScore), no Buyer Record with the buyers' names — usually a form signed
  // before any deal exists (a representation agreement, the Consumer Relationships Guide).
  // Then No deal is the default rather than a click (Dan, 2026-10-29). Only when there was
  // something to match on: no address and no names says nothing either way.
  const none = !!(address || buyerNames.length) && !named.length && !ranked.some((x) => x.score > 0.5);
  return { ranked: all, deal: null, by: none ? "none" : null };
}

/** Templates that can help a form: same page count AND at least one signature, initial or
 *  date block. Agents who rarely use Real Signature have many text-only templates.
 *  Page count unknown (WEBForms didn't say, and its PDFs hide the count in compressed object
 *  streams): every template with blocks, for the AGENT to choose from — dropping them all
 *  quietly made blockless drafts (outside review, 2026-10-15). planDraft never picks one
 *  blind; see unknownPages. */
export function usableTemplates(form, templates) {
  return templates.filter((t) => t.blocks > 0 && (!form.pageCount || t.pagesCount === form.pageCount));
}

/** job: the hand-off without PDFs. c: rs:context's answer. → {ready, needs: [why], and the
 *  rs:create choices: dealId (and dealBy, how it matched), templateIds (null = no template), counts, agentChoice}. */
export function planDraft({ job, c, remembered = {}, agentMode = "one" }) {
  const needs = [];
  const { deal, by } = confidentDeal(job.address, c.deals, job.buyerNames);
  // by "none": nothing came close, so No deal needs no choice (confidentDeal).
  if (!deal && by !== "none") {
    needs.push(job.address
      ? "No reZEN deal or Buyer Record clearly matches — choose one (or No deal)."
      : "No address or buyer name to match a reZEN deal with — choose one (or No deal).");
  }

  // Templates are remembered per side, and one with blocks only for the side that isn't
  // signing would place none — so the side is settled first (signingSide).
  const side = signingSide({ deal, agentSide: job.agentSide });
  const templateIds = job.forms.map((form) => {
    const usable = usableTemplates(form, c.templates);
    // Nothing to choose: blocks placed from the form's labels, the panel's default too (Dan,
    // 2026-10-29). A form it can't read gets no blocks, as before. Templates that fit but
    // aren't remembered still stop for the agent: one of them may be the one they want.
    if (!usable.length) return "auto";
    // Can't confirm any template fits: the agent chooses, even one remembered.
    if (!form.pageCount) {
      needs.push(`${form.name}: couldn't read its page count — choose the template.`);
      return null;
    }
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

  // Same default as the panel's box: the agent signs when a picked template has agent
  // blocks, or a form placed from its labels has an agent line (background.js `placed`).
  const agentOn = picked.some((t) => t.agentRole)
    || templateIds.some((id, i) => id === "auto" && job.forms[i].placed?.agent);
  return {
    ready: needs.length === 0,
    needs,
    dealId: deal?.id ?? null,
    // "address" or "name", or "none" when No deal was the default; for error reports (report.js).
    dealBy: deal || by === "none" ? by : null,
    templateIds,
    counts,
    agentChoice: agentOn ? (agentMode === "all" ? "all" : "best") : null,
  };
}

/** What one click chose, for the panel on that draft afterwards (Dan, 2026-10-29: so "it's
 *  clear that that choice was made"). guessed: it chose FOR the agent — No deal, or blocks
 *  from a form's labels — and the icon gets a badge. Stays in this browser (background.js
 *  showMade), never in a report. */
export function madeSummary({ plan, job, c }) {
  const deal = plan.dealId ? c.deals.find((d) => d.id === plan.dealId) : null;
  const forms = job.forms.map((f, i) => {
    const id = plan.templateIds[i];
    const t = c.templates.find((x) => x.id === id);
    return { name: f.name, how: id === "auto" ? "labels" : t ? "template" : "none", template: t?.name || null };
  });
  return {
    deal: deal ? (deal.address || (deal.buyerNames || []).join(" & ") || "a reZEN deal") : null,
    dealBy: deal ? plan.dealBy : null,
    forms,
    agent: !!plan.agentChoice,
    guessed: !deal || forms.some((f) => f.how === "labels"),
  };
}
