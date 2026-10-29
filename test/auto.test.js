import { test } from "node:test";
import assert from "node:assert/strict";
import { planDraft, confidentDeal, usableTemplates, madeSummary } from "../src/lib/auto.js";
import { summarizeBuyerRecord, matchesBuyerNames, wrongDealWarnings } from "../src/lib/deals.js";
import { buyerNamesFromFormValues } from "../src/lib/webforms-api.js";

// arrakis GET /buyer-record/{id}, shape as observed 2026-10-14; invented people.
const record = (id, first, last) => ({
  id, code: "AAA-BBB-CCC", lifecycleState: "ACTIVE", participants: [
    { internalParticipant: { userId: "me", role: "BUYERS_AGENT", owner: true, firstName: "Alex", lastName: "Example" }, externalParticipant: null },
    { internalParticipant: null, externalParticipant: { role: "BUYER", firstName: first, lastName: last, emailAddress: `${first.toLowerCase()}@example.com`, entityName: null } },
  ],
});

test("Buyer Record: summarised like a deal, buyers with emails, agents left to the agent box", () => {
  const b = summarizeBuyerRecord(record("b1", "Jordan", "Sample"));
  assert.equal(b.kind, "buyer");
  assert.equal(b.side, "BUYER");
  assert.equal(b.ownerId, "me");
  assert.deepEqual(b.buyerNames, ["Jordan Sample"]);
  assert.deepEqual(b.participants.map((p) => [p.role, p.email]), [["BUYER", "jordan@example.com"]]);
  assert.throws(() => summarizeBuyerRecord({ id: "x" }), /changed shape/);
  // No property yet, so no address warning against the form's address.
  assert.deepEqual(wrongDealWarnings({ webformsAddress: "120 Example Street NW", deal: b }), []);
});

test("Buyer Record: matched by the buyer names typed in WEBForms", () => {
  const b = summarizeBuyerRecord(record("b1", "Jordan", "Sample"));
  assert.equal(matchesBuyerNames(["Jordan & Riley Sample"], b), true);
  assert.equal(matchesBuyerNames(["JORDAN SAMPLE"], b), true);
  assert.equal(matchesBuyerNames(["Riley Sample"], b), false); // a shared surname isn't enough
  assert.equal(matchesBuyerNames([], b), false);
  assert.deepEqual(buyerNamesFromFormValues({ txtbuyer1: " Jordan  Sample ", txtbuyer2: "", txtbuyersig1: "Jordan Sample" }), ["Jordan Sample", "Jordan Sample"]);
});

test("one-click picks a Buyer Record only when exactly one matches by name", () => {
  const one = summarizeBuyerRecord(record("b1", "Jordan", "Sample"));
  const other = summarizeBuyerRecord(record("b2", "Casey", "Example"));
  const c = { me, deals: [deal({ address: "9 Other Road SW" }), one, other], templates: [tpl()] };
  const p = planDraft({ job: job({ address: "120 Example St NW", buyerNames: ["Jordan Sample"] }), c, remembered });
  assert.equal(p.ready, true, p.needs.join(" "));
  assert.equal(p.dealId, "b1");
  assert.deepEqual(p.counts, { BUYER: 1, SELLER: 0 }); // one buyer named in WEBForms
  const twice = summarizeBuyerRecord(record("b3", "Jordan", "Sample"));
  assert.equal(confidentDeal("", [one, twice], ["Jordan Sample"]).deal, null);
  // An address match to a real deal wins over a name.
  assert.equal(confidentDeal("120 Example St NW", [deal(), one], ["Jordan Sample"]).by, "address");
});

// Invented data only (public repo).
const me = { id: "me", fullName: "Alex Example", email: "alex@example.com", type: "AGENT" };
const deal = (over = {}) => ({
  id: "d1", kind: "deal", side: "BUYER", address: "120 Example Street NW, Calgary", agentName: "Alex Example", ownerId: "me",
  participants: [
    { role: "BUYER", firstName: "Jordan", lastName: "Sample", email: "jordan@example.com" },
    { role: "BUYERS_AGENT", firstName: "Alex", lastName: "Example", email: "alex@example.com" },
  ],
  ...over,
});
const tpl = (over = {}) => ({ id: "t1", name: "Offer", pagesCount: 6, blocks: 12, shared: false,
  slots: { BUYER: 2, SELLER: 0, AGENT: 1 }, agentRole: "BUYERS_AGENT", ...over });
const job = (over = {}) => ({
  title: "Offer", address: "120 Example St NW Calgary",
  forms: [{ name: "Residential Purchase Contract", library: "AREA0001", pageCount: 6, parties: { BUYER: 1, SELLER: 1 } }],
  ...over,
});
const remembered = { "lib:AREA0001": { id: "t1", template: "Offer", form: "Residential Purchase Contract", at: 1 } };

test("everything clear: ready, with the panel's own defaults", () => {
  const p = planDraft({ job: job(), c: { me, deals: [deal(), deal({ id: "d2", address: "9 Other Road SW" })], templates: [tpl()] }, remembered });
  assert.equal(p.ready, true, p.needs.join(" "));
  assert.equal(p.dealId, "d1");
  assert.deepEqual(p.templateIds, ["t1"]);
  assert.deepEqual(p.counts, { BUYER: 1, SELLER: 0 }); // one buyer named in WEBForms
  assert.equal(p.agentChoice, "best"); // the template has agent blocks
});

test("team practice of all agents signing is kept", () => {
  const p = planDraft({ job: job(), c: { me, deals: [deal()], templates: [tpl()] }, remembered, agentMode: "all" });
  assert.equal(p.agentChoice, "all");
});

test("no clear deal → the panel", () => {
  const two = [deal(), deal({ id: "d2" })]; // same address twice: a tie
  assert.equal(confidentDeal("120 Example St NW", two).deal, null);
  const p = planDraft({ job: job(), c: { me, deals: two, templates: [tpl()] }, remembered });
  assert.equal(p.ready, false);
  assert.match(p.needs[0], /choose one/);
  const none = planDraft({ job: job({ address: "" }), c: { me, deals: [deal()], templates: [tpl()] }, remembered });
  assert.match(none.needs[0], /No address/);
});

test("a template never chosen before → the panel, once", () => {
  const p = planDraft({ job: job(), c: { me, deals: [deal()], templates: [tpl()] }, remembered: {} });
  assert.equal(p.ready, false);
  assert.match(p.needs.join(" "), /choose a template once/);
});

test("the usual template no longer fits → the panel says why", () => {
  const p = planDraft({ job: job(), c: { me, deals: [deal()], templates: [tpl({ pagesCount: 7 }), tpl({ id: "t2", pagesCount: 6 })] }, remembered });
  assert.equal(p.ready, false);
  assert.match(p.needs.join(" "), /no longer fits/);
});

test("a usual template with blocks only for the other side → the panel, never an empty draft", () => {
  // the seller-only guide template on a buy-side deal: every block would be dropped
  const sellerOnly = tpl({ slots: { BUYER: 0, SELLER: 2, AGENT: 0 }, agentRole: null });
  const p = planDraft({ job: job(), c: { me, deals: [deal()], templates: [sellerOnly] }, remembered });
  assert.equal(p.ready, false);
  assert.match(p.needs.join(" "), /isn't used — it has seller blocks only, and this deal's signers are buyers/);
  // the buy-side choice is looked up first once there is one
  const perSide = { ...remembered, "lib:AREA0001|BUYER": { id: "t2", template: "Offer - Buyer", form: "x", at: 2 } };
  const q = planDraft({ job: job(), c: { me, deals: [deal()], templates: [sellerOnly, tpl({ id: "t2" })] }, remembered: perSide });
  assert.equal(q.ready, true, q.needs.join(" "));
  assert.deepEqual(q.templateIds, ["t2"]);
});

test("no templates that fit at all: one click, with blocks placed from the form's labels", () => {
  const p = planDraft({ job: job(), c: { me, deals: [deal()], templates: [tpl({ pagesCount: 3 })] }, remembered: {} });
  assert.equal(p.ready, true, p.needs.join(" "));
  assert.deepEqual(p.templateIds, ["auto"]);
  assert.equal(p.agentChoice, null);
});

test("page count unknown: never a blockless one-click draft, and every template is offered", () => {
  // outside review, 2026-10-15: all templates were dropped and the draft went out with none
  const unknown = job({ forms: [{ ...job().forms[0], pageCount: null }] });
  const p = planDraft({ job: unknown, c: { me, deals: [deal()], templates: [tpl()] }, remembered });
  assert.equal(p.ready, false, "even the remembered template isn't picked blind");
  assert.match(p.needs.join(" "), /couldn't read its page count/);
  assert.deepEqual(usableTemplates(unknown.forms[0], [tpl(), tpl({ id: "t2", pagesCount: 3 }), tpl({ id: "t3", blocks: 0 })]).map((t) => t.id),
    ["t1", "t2"], "the agent chooses from every template with blocks");
});

test("someone else's deal, or a client without an email → the panel", () => {
  const theirs = planDraft({ job: job(), c: { me, deals: [deal({ ownerId: "other", agentName: "Sam Teammate" })], templates: [tpl()] }, remembered });
  assert.equal(theirs.ready, false);
  assert.match(theirs.needs.join(" "), /Sam Teammate/);
  const noEmail = deal({ participants: [{ role: "BUYER", firstName: "Jordan", lastName: "Sample", email: "" }] });
  const p = planDraft({ job: job(), c: { me, deals: [noEmail], templates: [tpl()] }, remembered });
  assert.equal(p.ready, false);
  assert.match(p.needs.join(" "), /no email/);
});

test("placed blocks: an agent line on the form ticks the agent in, as a template's agent blocks do", () => {
  const withLine = job({ forms: [{ ...job().forms[0], placed: { blocks: 9, agent: true } }] });
  const p = planDraft({ job: withLine, c: { me, deals: [deal()], templates: [] }, remembered: {} });
  assert.deepEqual(p.templateIds, ["auto"]);
  assert.equal(p.agentChoice, "best");
  const noLine = job({ forms: [{ ...job().forms[0], placed: { blocks: 9, agent: false } }] });
  assert.equal(planDraft({ job: noLine, c: { me, deals: [deal()], templates: [] }, remembered: {} }).agentChoice, null);
});

test("no deal anywhere near the address or the buyers: No deal without a click", () => {
  const far = [deal({ id: "d2", address: "9 Other Road SW" }), deal({ id: "d3", address: "120 Example Avenue SE" })];
  const m = confidentDeal("120 Example St NW", far);
  assert.equal(m.deal, null);
  // 120 Example Avenue SE shares the civic number and the street name: close enough to ask.
  assert.equal(m.by, null);
  const nothing = confidentDeal("120 Example St NW", [deal({ id: "d2", address: "9 Other Road SW" })]);
  assert.equal(nothing.by, "none");
  const p = planDraft({ job: job(), c: { me, deals: [deal({ id: "d2", address: "9 Other Road SW" })], templates: [tpl()] }, remembered });
  assert.equal(p.dealId, null);
  assert.ok(!p.needs.some((n) => /deal/i.test(n)), p.needs.join(" "));
  assert.equal(p.ready, true, p.needs.join(" "));
  // Nothing to match on at all says nothing either way: still the agent's choice.
  assert.equal(confidentDeal("", [deal()]).by, null);
});

test("what one click chose, for the panel afterwards: guessed only when it chose for the agent", () => {
  const c = { me, deals: [deal()], templates: [tpl()] };
  const chosen = planDraft({ job: job(), c, remembered });
  const m = madeSummary({ plan: chosen, job: job(), c });
  assert.equal(m.deal, "120 Example Street NW, Calgary");
  assert.equal(m.dealBy, "address");
  assert.deepEqual(m.forms, [{ name: "Residential Purchase Contract", how: "template", template: "Offer" }]);
  assert.equal(m.agent, true);
  assert.equal(m.guessed, false); // all from the agent's own remembered choices: no badge

  const far = { me, deals: [deal({ id: "d2", address: "9 Other Road SW" })], templates: [] };
  const noDeal = planDraft({ job: job(), c: far, remembered });
  const n = madeSummary({ plan: noDeal, job: job(), c: far });
  assert.equal(n.deal, null);
  assert.equal(n.dealBy, null);
  assert.equal(n.forms[0].how, "labels");
  assert.equal(n.forms[0].chosen, false); // the default for a form with no template
  assert.equal(n.guessed, true);
});

test("labels chosen over a remembered template are remembered, and one click uses them", async () => {
  const { suggestTemplate, rememberEntry, rememberKey, LABELS, LABELS_NAME } = await import("../src/lib/match.js");
  const form = job().forms[0];
  // What the panel saves when the agent switches from the template used last time.
  const remembered = { [rememberKey(form, "BUYER")]: rememberEntry(form, { id: LABELS, name: LABELS_NAME }) };
  const s = suggestTemplate(form, [tpl()], remembered, "BUYER");
  assert.equal(s.labels, true);
  assert.equal(s.remembered, null);
  const p = planDraft({ job: job(), c: { me, deals: [deal()], templates: [tpl()] }, remembered });
  assert.equal(p.ready, true, p.needs.join(" "));
  assert.deepEqual(p.templateIds, ["auto"]);
  assert.deepEqual(p.labelsChosen, [true]); // the agent's choice: no "chose for you" dot
  const m = madeSummary({ plan: p, job: job(), c: { me, deals: [deal()], templates: [tpl()] } });
  assert.deepEqual(m.forms[0], { name: "Residential Purchase Contract", how: "labels", template: null, chosen: true });
  assert.equal(m.guessed, false);
  // The same form with nothing remembered: a template fits, so one click still asks.
  const asks = planDraft({ job: job(), c: { me, deals: [deal()], templates: [tpl()] }, remembered: {} });
  assert.equal(asks.ready, false);
  // No template fits at all: labels by default, not by choice.
  const none = planDraft({ job: job(), c: { me, deals: [deal()], templates: [] }, remembered: {} });
  assert.deepEqual(none.templateIds, ["auto"]);
  assert.deepEqual(none.labelsChosen, [false]);
});

test("deal picker: close matches first, then a sorted group per type, nothing twice", async () => {
  const { dealGroups } = await import("../src/lib/auto.js");
  const named = summarizeBuyerRecord(record("b1", "Jordan", "Sample"));
  const other = summarizeBuyerRecord(record("b2", "Casey", "Example"));
  const deals = [
    deal({ id: "d9", address: "9 Other Road SW" }),
    deal({ id: "d1" }), // 120 Example Street NW: the match
    deal({ id: "d10", address: "10 Other Road SW" }),
    deal({ id: "l1", kind: "listing", side: "SELLER", address: "44 Example Crescent NW" }),
    named, other,
  ];
  const { ranked } = confidentDeal("120 Example St NW", deals, ["Jordan Sample"]);
  const { top, groups } = dealGroups(ranked);
  assert.deepEqual(top.map((d) => d.id).sort(), ["b1", "d1"]); // the address match and the named record
  assert.deepEqual(groups.map((g) => g.label), ["Deals", "Listings", "Buyer Records"]);
  assert.deepEqual(groups[0].deals.map((d) => d.id), ["d9", "d10"]); // numeric order: 9 before 10
  assert.deepEqual(groups[1].deals.map((d) => d.id), ["l1"]);
  assert.deepEqual(groups[2].deals.map((d) => d.id), ["b2"]);
  const all = [...top, ...groups.flatMap((g) => g.deals)];
  assert.equal(new Set(all.map((d) => d.id)).size, deals.length); // every deal once
  // Nothing close: no top part, everything in its group.
  const far = dealGroups(confidentDeal("77 Nowhere Lane", [deal({ id: "d9", address: "9 Other Road SW" })]).ranked);
  assert.deepEqual(far.top, []);
  assert.deepEqual(far.groups.map((g) => g.label), ["Deals"]);
});
