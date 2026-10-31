// The PUT /document-templates/{id} body for one freshly uploaded draft: name, deal,
// signers, sender, and (if the agent picked one) a template's blocks.

import { applyToDraft, dropUnusedSlots } from "./layout.js";
import { samePerson } from "./actor.js";

const SIGNER_ROLES = ["BUYER", "SELLER"];

/** reZEN deal participants → how many buyers and sellers. */
export function countsFromDeal(deal) {
  const counts = {};
  for (const role of SIGNER_ROLES) counts[role] = (deal?.participants || []).filter((p) => p.role === role).length;
  return counts;
}

// Forms that only one side ever signs, by WEBForms form name. Deliberately narrow: a
// purchase contract, amendment or waiver can be signed by either side (or both, in dual),
// so those give no clue and fall through to the deal.
// A lease's tenant is the buyer's side and its landlord the seller's (Real Signature has only
// buyers and sellers): "Commercial Exclusive Tenant Representation Agreement".
const SELLER_FORM = /\b(sellers?'?s?|vendors?'?s?|listing|property disclosure|landlords?'?s?|lessors?'?s?)\b/i;
const BUYER_FORM = /\b(buyers?'?s?|purchasers?'?s?|tenants?'?s?|lessees?'?s?)\b/i;

/** "BUYER" / "SELLER" if the one-sided forms all point the same way, else null. A form that
 *  names neither side (a Consumer Relationships Guide) gives no clue and is skipped — it
 *  used to cancel a seller's agreement beside it (2026-10-15). One naming both ("Seller's
 *  Acceptance of Buyer's Offer") still means either side may sign. */
export function sideFromFormNames(names) {
  const sides = new Set();
  for (const n of names || []) {
    const s = SELLER_FORM.test(n), b = BUYER_FORM.test(n);
    if (s && b) return null;
    if (!s && !b) continue;
    sides.add(s ? "SELLER" : "BUYER");
  }
  return sides.size === 1 ? [...sides][0] : null;
}

/** A signing side gets at least this many slots. Deleting an unused signer in Real Signature
 *  is one click; adding one back means placing all their blocks by hand (Dan, 2026-10-11). */
export const MIN_SIGNERS = 2;
const atLeast = (n) => Math.max(MIN_SIGNERS, n);

/** A template's signer slots: for each side, how many signers it has blocks for
 *  (highest signeeIndex + 1). Name fields count too — a "Buyer 2 name" line still needs a
 *  Buyer 2. */
export function templateSlots(fieldDefinitions) {
  const out = { BUYER: 0, SELLER: 0 };
  for (const f of fieldDefinitions || []) {
    if (f.signeeType in out) out[f.signeeType] = Math.max(out[f.signeeType], (f.signeeIndex ?? 0) + 1);
  }
  out.AGENT = (fieldDefinitions || []).filter((f) => AGENT_ROLES.includes(f.signeeType)).length;
  return out;
}

/** "BUYER" / "SELLER" if the picked templates only ever have blocks for one side. */
function sideFromTemplates(slots) {
  const b = slots.some((x) => x.BUYER > 0), s = slots.some((x) => x.SELLER > 0);
  return b === s ? null : b ? "BUYER" : "SELLER";
}

/** How many buyers and sellers sign, and why (for the panel to say).
 *
 *  Which side signs: the agent's own clients do; the other side's sign through their own
 *  agent, and reZEN holds them without an email anyway (every open deal checked,
 *  2026-10-11). So a buy-side deal → buyers, listing side → sellers. When the deal can't
 *  say (dual, unknown, or no deal): the picked templates first — an agent who built a
 *  template with seller blocks only meant it for sellers — then the form names, else both.
 *
 *  How many on a signing side: as many as are named on the WEBForms form ("A & B" on one
 *  line counts as two). Nobody named on that side → the most of the deal's people, the
 *  picked templates' slots and MIN_SIGNERS. With a template, a named count below its slots
 *  leaves the spare signers' blocks off; without one, only signer roles are set up, so a
 *  slot more or less costs nothing. The agent can always change the numbers.
 *
 *  templates: templateSlots() of each picked template (none picked → []).
 *  webforms: partiesFromFormValues() of each form ({BUYER, SELLER} counts). */
export function signerCounts({ deal, formNames, templates = [], webforms = [], agentSide = null }) {
  const n = deal ? countsFromDeal(deal) : { BUYER: 0, SELLER: 0 };
  const byTemplate = sideFromTemplates(templates);
  const byName = sideFromFormNames(formNames);
  const many = (xs) => (xs || []).length > 1;
  const formsAre = (side) => `${many(formNames) ? "these are" : "this is a"} ${side === "BUYER" ? "buyer" : "seller"}'s form${many(formNames) ? "s" : ""}`;
  const tpl = (side) => `your template${many(templates) ? "s only have" : " only has"} ${side === "BUYER" ? "buyer" : "seller"} blocks`;

  let side, why;
  if (deal?.side === "BUYER") { side = "BUYER"; why = "This deal is buy-side, so its buyers sign; the sellers sign with their own agent."; }
  else if (deal?.side === "SELLER") { side = "SELLER"; why = "This deal is listing-side, so its sellers sign; the buyers sign with their own agent."; }
  // No deal side: the agent emails on the WEBForms form say which side the agent is on
  // (agentSideFromFormValues) — the buyer's agent's clients are the buyers.
  else if (agentSide === "BUYER") { side = "BUYER"; why = "You're the buyer's agent on the WEBForms form, so the buyers sign; the sellers sign with their own agent."; }
  else if (agentSide === "SELLER") { side = "SELLER"; why = "You're the listing agent on the WEBForms form, so the sellers sign; the buyers sign with their own agent."; }
  else if (agentSide === "DUAL" && !byTemplate) { side = "BOTH"; why = "You're the agent for both sides on the WEBForms form, so buyers and sellers both sign."; }
  else {
    const lead = deal?.side === "DUAL" ? "Dual representation" : deal ? "Couldn't tell which side this deal is" : "No deal";
    if (byTemplate) { side = byTemplate; why = `${lead}, and ${tpl(side)}, so only the ${side === "BUYER" ? "buyers" : "sellers"} sign.`; }
    else if (byName) { side = byName; why = `${lead}, and ${formsAre(side)}, so only the ${side === "BUYER" ? "buyers" : "sellers"} sign.`; }
    else { side = "BOTH"; why = `${lead}, so buyers and sellers are both included.`; }
  }

  // How many on a signing side: the names typed on the form when there are any (Dan,
  // 2026-10-14: "if we can read the number of buyers or sellers on the form, set to that
  // number. if we can't read them, default to 2"). Then the picked deal's own clients.
  // Only when neither names anybody on that side: the template's slots or MIN_SIGNERS.
  const counts = {};
  const notes = [];
  for (const role of SIGNER_ROLES) {
    if (side !== "BOTH" && side !== role) { counts[role] = 0; continue; }
    const who = role === "BUYER" ? "buyer" : "seller";
    const fromForms = Math.max(0, ...webforms.map((x) => x[role] || 0));
    if (fromForms > 0) {
      counts[role] = fromForms;
      notes.push(`${fromForms} ${who}${fromForms === 1 ? "" : "s"} named in WEBForms`);
      continue;
    }
    // Next, the deal the agent picked: it lists its clients, so its count is better than a
    // guess (Dan, 2026-10-31: a deal with one buyer, a commercial form whose names we can't
    // read, and the panel said 2). A template with more slots loses the spare's blocks, as
    // with names read off the form.
    if (n[role] > 0) {
      counts[role] = n[role];
      notes.push(`${n[role]} ${who}${n[role] === 1 ? "" : "s"} on the reZEN deal`);
      continue;
    }
    const fromTemplates = Math.max(0, ...templates.map((x) => x[role] || 0));
    const base = MIN_SIGNERS;
    counts[role] = Math.max(base, fromTemplates);
    notes.push(fromTemplates > base ? `no ${who}s named in WEBForms, and your template has blocks for ${fromTemplates}`
      : `no ${who}s named in WEBForms, so ${counts[role]}`);
  }
  if (notes.length) why += ` Numbers: ${notes.join("; ")}.`;
  return { counts, why };
}

/** A usable email: something Real Signature will take. One bad email and Real refuses the
 *  whole draft ("defaults.signees[0].email: not a well-formed email address", 2026-10-14 —
 *  it was "[object Object]", a Contacts field misread; see webforms-api.js `field`).
 *  Anything else counts as no email: the signer is left off and named in the panel. */
export const isEmail = (s) => /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i.test(String(s ?? "").trim());
const hasEmail = (p) => isEmail(p.email);

/** A signer's name: the person's, or the company's when the client is a company (reZEN's
 *  `company`, a Buyer Record's `entityName`). "" when reZEN has neither. */
export const personName = (p) => [p.firstName, p.lastName].filter(Boolean).join(" ") || String(p.company ?? "").trim();
/** Real Signature takes a signer only with an email and a name: a blank one refuses the whole
 *  draft ("defaults.signees[0].name: must not be blank", 2026-10-31). */
const canSign = (p) => hasEmail(p) && !!personName(p);

/** Deal signers Real Signature can't take yet: reZEN often has a buyer or seller with no
 *  email, and Real refuses the whole draft ("defaults.signees[n].email: must not be blank",
 *  2026-10-11); the same for no name at all. They're left out; the panel names them so the
 *  agent adds them by hand. `noName` marks one with an email but no name. */
export function signersWithoutEmail(deal, counts) {
  const out = [];
  for (const role of SIGNER_ROLES) {
    (deal?.participants || []).filter((p) => p.role === role).slice(0, counts[role] ?? 0)
      .forEach((p, i) => {
        if (!hasEmail(p)) out.push({ role, slot: i + 1, name: personName(p) });
        else if (!personName(p)) out.push({ role, slot: i + 1, name: "", noName: true });
      });
  }
  return out;
}

/** reZEN participants → Real Signature signees, Buyer 1 = BUYER/0. Only as many per role as
 *  `counts` allows; everyone signs in parallel (signOrder 1) — the agent can change the
 *  order in Real Signature before sending. Anyone without an email is skipped (see
 *  signersWithoutEmail) but keeps their slot number, so Buyer 2 stays Buyer 2 and the
 *  template's blocks still point at the right person. */
export function signeesFromDeal(deal, counts) {
  const out = [];
  for (const role of SIGNER_ROLES) {
    const people = (deal?.participants || []).filter((p) => p.role === role).slice(0, counts[role] ?? 0);
    people.forEach((p, i) => canSign(p) && out.push({
      signeeType: role,
      signeeIndex: i,
      name: personName(p),
      email: String(p.email).trim(),
      signOrder: 1,
    }));
  }
  return out;
}

/** Without a template the draft still needs to say who signs, so Real Signature offers
 *  those signers on its Prepare step. minNum 0, like the agents' own templates: the
 *  defaults deliberately over-provide (MIN_SIGNERS), and a minimum would stop the agent
 *  deleting the spare. */
function configsFromCounts(counts) {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([signeeType, n]) => ({ signeeType, minNum: 0, maxNum: n }));
}

// ---- the agent as a signer ----
// Real Signature's "SENDER" slots are fill-before-send fields (text, dates, checkboxes),
// never signatures; agents sign as BUYERS_AGENT / SELLERS_AGENT (checked on the agents'
// templates, and Real accepts both as signees on a draft, 2026-10-12).
export const AGENT_ROLES = ["BUYERS_AGENT", "SELLERS_AGENT"];
const AGENT_FOR_SIDE = { BUYER: "BUYERS_AGENT", SELLER: "SELLERS_AGENT" };

/** Which agent role signs one document, or null.
 *  A template that has agent blocks decides (its role). A template WITHOUT agent blocks says
 *  the agent doesn't sign this form → null. No template: the side that signs (from counts).
 *  A form both sides sign (an agreement to represent buyer and seller) has agent lines too,
 *  so with no template the deal's own side names the role — the agent's role on that deal.
 *  Both sides and no deal side to go on (no deal, or a dual deal) → null: nothing says which. */
export function agentRoleFor({ layout, counts, dealSide = null }) {
  if (layout) {
    const roles = [...new Set((layout.signeeConfigs || []).map((c) => c.signeeType).filter((t) => AGENT_ROLES.includes(t)))];
    return roles.length === 1 ? roles[0] : null;
  }
  const sides = Object.keys(AGENT_FOR_SIDE).filter((s) => (counts?.[s] ?? 0) > 0);
  if (sides.length === 1) return AGENT_FOR_SIDE[sides[0]];
  return AGENT_FOR_SIDE[dealSide] ?? null;
}

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Everyone who could sign as the agent, best first: the deal's participants in that role
 *  with an email — the signed-in agent first, then the deal owner by name, then the rest in
 *  reZEN's order. A team deal often lists two or more; some teams have one sign, some
 *  jurisdictions want all (the panel asks). With no deal, or a deal that lists nobody in the
 *  role, the signed-in user if they are an agent and it's theirs. A TC is never put in as
 *  the agent. → [{name, email}] */
export function agentPeople({ deal, role, me, webformsUserName = null, webformsUserEmail = null }) {
  const full = personName;
  const seen = new Set();
  const people = (deal?.participants || [])
    .filter((p) => p.role === role && canSign(p))
    .filter((p) => !seen.has(norm(p.email)) && seen.add(norm(p.email)));
  // Whose forms these are comes first: a team lead impersonating a teammate in WEBForms (or
  // a TC working in an agent's account) is doing that agent's file, even when the signed-in
  // Real user is also on the deal. Then the signed-in agent, then the deal owner.
  // By email when WEBForms gave one (names can be shared within a family team); only the
  // exact name otherwise. This only orders the suggestions — the agent sees and picks.
  const isWf = (p) => (webformsUserEmail ? samePerson({ wfEmail: webformsUserEmail, rsEmail: p.email }) === true
    : !!webformsUserName && norm(full(p)) === norm(webformsUserName));
  const rank = (p) => (isWf(p) ? 0
    : norm(p.email) === norm(me?.email) ? 1 : norm(full(p)) === norm(deal?.agentName) ? 2 : 3);
  const sorted = people.map((p, i) => [rank(p), i, p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , p]) => p);
  if (sorted.length) return sorted.map((p) => ({ name: full(p), email: String(p.email).trim() }));
  const meIsAgent = me?.type === "AGENT" && hasEmail(me);
  if (meIsAgent && (!deal || deal.ownerId === me.id)) {
    return [{ name: me.fullName || full(me), email: String(me.email).trim() }];
  }
  return [];
}

/** The one agent who signs when only one does. → {name, email} or null. */
export function agentPerson(args) {
  return agentPeople(args)[0] || null;
}

/** Which of agentPeople() sign: "all", or one person by email (falls back to the best match
 *  when that person isn't on this role's list, e.g. a different role on another form). */
export function chooseAgents(people, choice) {
  if (!people.length) return [];
  if (choice === "all") return people;
  return [people.find((p) => norm(p.email) === norm(choice)) || people[0]];
}

/** The signer roles a draft body sets up but doesn't fill: fewer named signees than the
 *  role's slots (a buyer with no email, a standalone form with no deal). → [signeeType]
 *  Why it matters: on a single document, Real Signature's Edit details lists only named
 *  signers, and its Next DELETES every role nobody is in — blocks and all (2026-10-14).
 *  A packet, even of one document, lists every role and asks for each (Add Signees). */
export function unfilledRoles(body) {
  const named = {};
  for (const s of body?.defaults?.signees || []) named[s.signeeType] = (named[s.signeeType] || 0) + 1;
  return (body?.signeeConfigs || []).filter((c) => (c.maxNum ?? 0) > (named[c.signeeType] || 0)).map((c) => c.signeeType);
}

// Real Signature refuses the whole save over a long subject: "defaults.emailSubject: size
// must be between 0 and 70" (400, a Winnipeg tester, 2026-10-26: a long address plus
// "MLS® Listing Withdrawal Contract"). Shortened at a word, never refused.
export const SUBJECT_MAX = 70;

/** The subject as Real Signature will count it: runs of spaces as one, ends trimmed. */
export function cleanSubject(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** True when Real Signature would refuse this subject. The panel shows the subject and
 *  holds "Finish draft" until the agent shortens it, and one click stops and hands over to
 *  the panel: a subject the agent never saw isn't rewritten on the way (Dan, 2026-10-26). */
export function subjectTooLong(s) {
  return cleanSubject(s).length > SUBJECT_MAX;
}

/** Backstop only: the signers' email subject cut to fit Real's limit, at a word boundary
 *  with "…". The panel and one click both stop a long subject before it gets here, so in
 *  normal use this never cuts; it stays so a missed path can't fail the whole save. */
export function fitSubject(s) {
  const t = cleanSubject(s);
  if (!t) return null;
  if (t.length <= SUBJECT_MAX) return t;
  const room = t.slice(0, SUBJECT_MAX - 1);
  const cut = room.lastIndexOf(" ");
  return `${(cut > SUBJECT_MAX / 2 ? room.slice(0, cut) : room).replace(/[\s,;:–—-]+$/, "")}…`;
}

/** draft: GET /document-templates/{id} straight after upload. layout: stripped and
 *  slot-trimmed template, or null. PUT is a FULL replace, so every key the draft had is
 *  carried through. agents: {signeeType, people: [{name, email}]} to add the agent(s) as
 *  signers, or null. Agent 1 takes the template's agent blocks; any more are added as
 *  signers whose blocks the agent places in Real Signature. */
export function buildDraftBody({ draft, layout: tpl, name, pageCount, transactionId, counts, signees, sender, agents = null, emailSubject = null }) {
  // One agent signing a template built for two: Agent 2's blocks come off, like a spare
  // buyer's. Left on, Real Signature's Edit details step wouldn't let the agent past it —
  // "Buyer Agent 2" had blocks and nobody assigned (2026-10-14, Exclusive Buyer
  // Representation Agreement). More agents than the template has slots: kept, and the
  // extra ones get their blocks placed by hand, as before.
  const layout = tpl && agents?.people?.length
    ? dropUnusedSlots(tpl, { [agents.signeeType]: agents.people.length }) : tpl;
  const pages = layout?.pagesCount ?? pageCount ?? draft.pagesCount ?? null;
  const base = layout
    ? applyToDraft({ ...draft, pagesCount: pageCount ?? draft.pagesCount }, layout)
    : { ...draft, fieldDefinitions: [], documentFieldValidations: [], signeeConfigs: configsFromCounts(counts) };
  const all = [...signees];
  if (agents?.people?.length) {
    const type = agents.signeeType, n = agents.people.length;
    const has = base.signeeConfigs.find((c) => c.signeeType === type);
    base.signeeConfigs = has
      ? base.signeeConfigs.map((c) => (c === has ? { ...c, maxNum: Math.max(c.maxNum ?? 0, n) } : c))
      : [...base.signeeConfigs, { signeeType: type, minNum: 0, maxNum: n }];
    agents.people.forEach((p, i) => all.push({ signeeType: type, signeeIndex: i, name: p.name, email: p.email, signOrder: 1 }));
  }
  const types = new Set(base.signeeConfigs.map((c) => c.signeeType));
  const prev = draft.defaults || {};
  return {
    ...base,
    name,
    pagesCount: pages,
    defaults: {
      ...prev,
      transactionId: transactionId || null,
      signees: all.filter((s) => types.has(s.signeeType)),
      recipients: prev.recipients || [],
      sender,
      // The signers' email subject: the title the agent saw (and could edit) in the panel.
      emailSubject: fitSubject(emailSubject || prev.emailSubject),
      emailBody: prev.emailBody ?? null,
    },
  };
}
