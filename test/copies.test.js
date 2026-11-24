// One signer per copy (issue #9). Invented data only.
import test from "node:test";
import assert from "node:assert/strict";

import { copyGroups, namedAcrossCopies, namesPerson, oneSignerPlan, oneSignerDefault, onlySigner, planLines } from "../src/lib/copies.js";
import { buildDraftBody, signeesFromDeal, signerCounts } from "../src/lib/draft.js";
import { stripTemplate, dropUnusedSlots } from "../src/lib/layout.js";
import { partyNamesFromFormValues, partiesFromFormValues } from "../src/lib/webforms-api.js";
import { planDraft } from "../src/lib/auto.js";
import { sampleTemplate } from "./fixtures.js";

const buyers = [
  { role: "BUYER", firstName: "Jordan", lastName: "Sample", email: "jordan@example.com" },
  { role: "BUYER", firstName: "Riley", lastName: "Sample", email: "riley@example.com" },
];
// A form as the hand-off carries it: its counts and its own name lines (webforms-api.js).
const copy = (values, extra = {}) => ({ name: "Sample Disclosure", library: "SAMPLE0001",
  parties: partiesFromFormValues(values), names: partyNamesFromFormValues(values), ...extra });
const BUYERS = { BUYER: 2, SELLER: 0 };

test("copies of one form are grouped by library code, else by name", () => {
  const forms = [{ name: "A", library: "X1" }, { name: "B" }, { name: "A again", library: "X1" }, { name: "b" }, { name: "C" }];
  assert.deepEqual(copyGroups(forms), [[0, 2], [1, 3]]);
  assert.deepEqual(copyGroups([{ name: "A" }, { name: "C" }]), []);
});

test("a name line names a person by every word of their name, in any order", () => {
  assert.ok(namesPerson("Sample, Jordan A.", buyers[0]));
  assert.ok(!namesPerson("Jordan Example", buyers[0]));
  assert.ok(!namesPerson("Jordan Sample", { role: "BUYER", firstName: "", lastName: "" }), "nobody without a name");
  assert.ok(namesPerson("Example Holdings Ltd.", { role: "BUYER", company: "Example Holdings Ltd" }));
});

test("party name lines: the party lines, else the signature-name lines, without run-on lines", () => {
  assert.deepEqual(partyNamesFromFormValues({ txtbuyer1: "Jordan  Sample", txtbuyersig1: "J Sample" }), { BUYER: ["Jordan Sample"], SELLER: [] });
  assert.deepEqual(partyNamesFromFormValues({ txtbuyersig1: "Riley Sample" }).BUYER, ["Riley Sample"]);
  assert.deepEqual(partyNamesFromFormValues({ txtseller1: "Example Holdings Ltd.", txtseller2: "(operating as Example Homes)" }).SELLER, ["Example Holdings Ltd."]);
});

test("copies naming one different person each name them all", () => {
  const forms = [copy({ txtbuyer1: "Jordan Sample" }), copy({ txtbuyer1: "Riley Sample" })];
  assert.deepEqual(namedAcrossCopies(forms), { BUYER: 2, SELLER: 0 });
  assert.equal(namedAcrossCopies([copy({ txtbuyer1: "Jordan Sample" }), copy({ txtbuyer1: "Sample, Jordan" })]).BUYER, 1, "the same buyer twice");
  assert.equal(namedAcrossCopies([copy({ txtbuyer1: "Jordan Sample" }), { ...copy({ txtbuyer1: "Riley Sample" }), library: "OTHER" }]).BUYER, 0, "not copies");
  // Each form alone names one buyer: before this, the panel said 1 and Riley got no copy.
  const { counts } = signerCounts({ deal: null, formNames: ["Sample Disclosure"], webforms: [...forms.map((f) => f.parties), namedAcrossCopies(forms)], agentSide: "BUYER" });
  assert.equal(counts.BUYER, 2);
});

test("each copy's own buyer line → that buyer's copy, in the deal's slot", () => {
  const forms = [copy({ txtbuyer1: "Riley Sample" }), { name: "Other Form" }, copy({ txtbuyer1: "Jordan Sample" })];
  const plan = oneSignerPlan({ forms, people: buyers, counts: BUYERS });
  assert.equal(plan.refused, null);
  assert.equal(plan.by, "form");
  assert.equal(plan.side, "BUYER");
  assert.deepEqual(plan.copies, [{ form: 0, slot: 1, line: 0, name: "Riley Sample" }, { form: 2, slot: 0, line: 0, name: "Jordan Sample" }]);
  assert.ok(oneSignerDefault(plan), "on: the copies themselves say who");
  assert.deepEqual(planLines(plan), ["Sample Disclosure, copy 1: Riley Sample (Buyer 2)", "Sample Disclosure, copy 2: Jordan Sample (Buyer 1)"]);
});

test("copies naming nobody go in order, and that is never the default", () => {
  const plan = oneSignerPlan({ forms: [copy({}), copy({})], people: buyers, counts: BUYERS });
  assert.equal(plan.by, "order");
  assert.deepEqual(plan.copies.map((c) => [c.form, c.slot, c.line]), [[0, 0, null], [1, 1, null]]);
  assert.equal(oneSignerDefault(plan), false, "off: copies aren't always for different people");
  const short = oneSignerPlan({ forms: [copy({}), copy({})], people: [...buyers, { ...buyers[0], firstName: "Casey" }], counts: { BUYER: 3 } });
  assert.match(short.refused, /2 copies of Sample Disclosure and 3 buyers/);
});

test("refuses rather than guesses when the names don't settle it", () => {
  const plan = (forms, people = buyers, counts = BUYERS) => oneSignerPlan({ forms, people, counts });
  const no = (p, re) => { assert.ok(p.offer); assert.deepEqual(p.copies, []); assert.match(p.refused, re); assert.equal(oneSignerDefault(p), false); };
  no(plan([copy({ txtbuyer1: "Jordan Sample" }), copy({ txtbuyer1: "Casey Example" })]), /copy 2 names "Casey Example", and the buyers are Jordan Sample and Riley Sample/);
  no(plan([copy({ txtbuyer1: "Jordan Sample" }), copy({ txtbuyer1: "Sample, Jordan" })]), /copy 1 and copy 2 both name Jordan Sample/);
  no(plan([copy({ txtbuyer1: "Jordan & Riley Sample" }), copy({ txtbuyer1: "Riley Sample" })]), /copy 1 names 2 buyers/);
  no(plan([copy({ txtbuyer1: "Jordan Sample" }), copy({})]), /copy 2 names no buyer while another copy does/);
  no(plan([copy({ txtbuyer1: "Sample" }), copy({ txtbuyer1: "Riley Sample" })], [{ ...buyers[0], firstName: "" }, { ...buyers[1], firstName: "" }]), /matches more than one buyer/);
  no(plan([copy({ txtbuyer1: "Jordan Sample" }), copy({ txtbuyer1: "Riley Sample" })], []), /there are no buyers to match/);
  no(plan([copy({}), copy({})], buyers, { BUYER: 2, SELLER: 1 }), /both sign/);
});

test("nothing to offer: no copies, or one signer on the side", () => {
  assert.equal(oneSignerPlan({ forms: [copy({}), { name: "Other" }], people: buyers, counts: BUYERS }).offer, false);
  assert.equal(oneSignerPlan({ forms: [copy({}), copy({})], people: buyers, counts: { BUYER: 1 } }).offer, false);
});

// A two-buyer template, the deal's two buyers, and the agent: copy 2 for Riley.
function twoBuyerBody() {
  const t = sampleTemplate();
  t.fieldDefinitions.push({ index: 5, type: "SIGNATURE", signeeType: "BUYERS_AGENT", signeeIndex: 0, fieldLocations: [{ pageNum: 2, position: [100, 500, 200, 30] }] });
  t.signeeConfigs.push({ signeeType: "BUYERS_AGENT", minNum: 0, maxNum: 1 });
  const counts = { BUYER: 2, SELLER: 0 };
  const layout = dropUnusedSlots(stripTemplate(t), counts);
  const draft = { id: "new", name: "x.pdf", type: "USER_PDF", pagesCount: 3, defaults: null, fieldDefinitions: [], signeeConfigs: [], documentFieldValidations: [] };
  return buildDraftBody({ draft, layout, name: "x", pageCount: 3, transactionId: "deal-1", counts,
    signees: signeesFromDeal({ participants: buyers }, counts), sender: { email: "alex@example.com" },
    agents: { signeeType: "BUYERS_AGENT", people: [{ name: "Alex Example", email: "alex@example.com" }] } });
}

test("a copy keeps only its signer's blocks and signee, and the agent's", () => {
  const { body, blocks } = onlySigner(twoBuyerBody(), { side: "BUYER", slot: 1, line: null });
  assert.equal(blocks, 2);
  assert.deepEqual(body.fieldDefinitions.map((f) => [f.index, f.signeeType, f.signeeIndex]),
    [[0, "BUYER", 1], [1, "BUYER", 1], [2, "BUYERS_AGENT", 0]], "Buyer 1's blocks off, the agent's kept");
  assert.deepEqual(body.documentFieldValidations.map((v) => v.fieldIndex), [1], "validations follow the renumbering");
  assert.deepEqual(body.defaults.signees.map((s) => [s.signeeType, s.signeeIndex, s.name]), [["BUYER", 1, "Riley Sample"], ["BUYERS_AGENT", 0, "Alex Example"]]);
  assert.equal(body.signeeConfigs.find((c) => c.signeeType === "BUYER").maxNum, 2, "reaches Buyer 2");
  assert.equal(body.defaults.transactionId, "deal-1", "the rest of the body is kept");
});

test("a copy named on its first line keeps the first line's blocks, as its own signer's", () => {
  const { body } = onlySigner(twoBuyerBody(), { side: "BUYER", slot: 1, line: 0 });
  assert.deepEqual(body.fieldDefinitions.filter((f) => f.signeeType === "BUYER").map((f) => [f.type, f.signeeIndex]),
    [["INITIALS", 1], ["SIGNED_DATE", 1]], "Buyer 1's places, now Riley's");
});

test("a one-signer template: the second copy's signer takes Buyer 1's blocks", () => {
  const counts = { BUYER: 1 };
  const one = buildDraftBody({ draft: { name: "x", pagesCount: 3 }, layout: dropUnusedSlots(stripTemplate(sampleTemplate()), counts),
    name: "x", pageCount: 3, counts, signees: signeesFromDeal({ participants: buyers }, { BUYER: 2 }), sender: null });
  const { body, blocks } = onlySigner(one, { side: "BUYER", slot: 1, line: null });
  assert.equal(blocks, 2);
  assert.ok(body.fieldDefinitions.filter((f) => f.signeeType === "BUYER").every((f) => f.signeeIndex === 1));
});

test("no template (or Auto place found nothing): only the roles and signees change", () => {
  const counts = { BUYER: 2 };
  const none = buildDraftBody({ draft: { name: "x" }, layout: null, name: "x", counts, signees: signeesFromDeal({ participants: buyers }, counts), sender: null });
  const { body, blocks, hadBlocks } = onlySigner(none, { side: "BUYER", slot: 0 });
  assert.equal(blocks, 0);
  assert.equal(hadBlocks, false, "nothing to say: there were none");
  assert.deepEqual(body.signeeConfigs, [{ signeeType: "BUYER", minNum: 0, maxNum: 1 }]);
  assert.deepEqual(body.defaults.signees.map((s) => s.name), ["Jordan Sample"]);
});

test("one click stops for the agent when copies of one form would be split", () => {
  const deal = { id: "deal-1", address: "120 Example Street NW", side: "BUYER", participants: buyers };
  const c = { deals: [deal], templates: [], me: { email: "alex@example.com", type: "AGENT" } };
  const job = { address: "120 Example Street NW", forms: [copy({ txtbuyer1: "Jordan Sample" }), copy({ txtbuyer1: "Riley Sample" })] };
  const plan = planDraft({ job, c });
  assert.equal(plan.ready, false);
  assert.ok(plan.needs.some((n) => /more than one copy/.test(n)));
  // Refused (both copies name the same buyer): today's draft, no stop for it.
  const same = planDraft({ job: { ...job, forms: [copy({ txtbuyer1: "Jordan Sample" }), copy({ txtbuyer1: "Jordan Sample" })] }, c });
  assert.ok(!same.needs.some((n) => /more than one copy/.test(n)));
});
