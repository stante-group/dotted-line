import test from "node:test";
import assert from "node:assert/strict";

import { stripTemplate, dropUnusedSlots, offsetPages, mergeLayouts, applyToDraft } from "../src/lib/layout.js";
import { suggestTemplate, checkPages, formKey, rememberEntry, rememberedId, pruneRemembered, signingSide, rememberKey, sideMismatch } from "../src/lib/match.js";
import { normalizeAddress, addressScore, rankDeals, wrongDealWarnings } from "../src/lib/deals.js";
import { sampleTemplate, sampleDeals } from "./fixtures.js";

test("stripTemplate keeps blocks and drops every personal field", () => {
  const l = stripTemplate(sampleTemplate());
  assert.deepEqual(Object.keys(l).sort(), ["documentFieldValidations", "fieldDefinitions", "pagesCount", "signeeConfigs"]);
  const s = JSON.stringify(l);
  for (const leak of ["Jordan", "example.com", "tx-sample", "Hi Jordan", "tmpl-sample-1"]) {
    assert.ok(!s.includes(leak), `layout leaked ${leak}`);
  }
});

test("stripTemplate fails loudly on an unexpected shape", () => {
  assert.throws(() => stripTemplate({ name: "x" }), /fieldDefinitions/);
});

test("one buyer: Buyer 2 blocks go, validations follow the renumbering", () => {
  const l = dropUnusedSlots(stripTemplate(sampleTemplate()), { BUYER: 1, SELLER: 1 });
  assert.deepEqual(l.fieldDefinitions.map((f) => [f.index, f.type, f.signeeType, f.signeeIndex]), [
    [0, "INITIALS", "BUYER", 0],
    [1, "SIGNATURE", "SELLER", 0],
    [2, "SIGNED_DATE", "BUYER", 0],
  ]);
  // old 2 (seller sig) → 1, old 4 (date) → 2, old 3 (buyer 2 sig) gone
  assert.deepEqual(l.documentFieldValidations.map((v) => v.fieldIndex), [1, 2]);
  assert.equal(l.signeeConfigs.find((c) => c.signeeType === "BUYER").maxNum, 1);
});

test("merge offsets pages and indexes across forms", () => {
  const a = stripTemplate(sampleTemplate());
  const b = offsetPages(stripTemplate(sampleTemplate()), 0);
  const m = mergeLayouts([a, b]);
  assert.equal(m.pagesCount, 6);
  assert.equal(m.fieldDefinitions.length, 10);
  assert.equal(m.fieldDefinitions[5].fieldLocations[0].pageNum, 3); // b's page 0 → 3
  assert.deepEqual(m.fieldDefinitions.map((f) => f.index), [...Array(10).keys()]);
  assert.deepEqual(m.documentFieldValidations.map((v) => v.fieldIndex), [2, 3, 4, 7, 8, 9]);
});

test("applyToDraft refuses a template for a revised form", () => {
  const layout = stripTemplate(sampleTemplate());
  assert.throws(() => applyToDraft({ name: "x", pagesCount: 4 }, layout), /page count differs/);
  const body = applyToDraft({ name: "x", type: "USER_PDF", pagesCount: 3, defaults: { transactionId: "t" } }, layout);
  assert.equal(body.defaults.transactionId, "t");
  assert.equal(body.fieldDefinitions.length, 5);
});

test("template matching: remembered choice refused when pages differ", () => {
  const t = { id: "a", name: "Residential Purchase Contract", pagesCount: 9 };
  const form = { name: "Residential Purchase Contract", pageCount: 10 };
  const r = suggestTemplate(form, [t], { [formKey(form)]: "a" });
  assert.equal(r.remembered, null);
  assert.match(r.refused.reason, /10 pages/);
  assert.equal(checkPages({ pageCount: 9 }, t).ok, true);
});

test("template matching: name suggestions only when pages fit", () => {
  const ts = [
    { id: "a", name: "Residential Purchase Contract", pagesCount: 9 },
    { id: "b", name: "Purchase Contract (old)", pagesCount: 8 },
    { id: "c", name: "Amendment", pagesCount: 1 },
  ];
  const r = suggestTemplate({ name: "Residential Purchase Contract.pdf", pageCount: 9 }, ts);
  assert.deepEqual(r.suggestions.map((t) => t.id), ["a"]);
});

test("template matching: remembered per side, and a template with no blocks for this side is refused", () => {
  // a form both sides sign: one template per side, since every block belongs to a role
  const form = { name: "Consumer Relationships Guide", library: "AREA0001", pageCount: 2 };
  const seller = { id: "s", name: "Consumer Relationships Guide - Seller", pagesCount: 2, slots: { BUYER: 0, SELLER: 2, AGENT: 0 } };
  const buyer = { id: "b", name: "Consumer Relationships Guide - Buyer", pagesCount: 2, slots: { BUYER: 2, SELLER: 0, AGENT: 0 } };
  assert.equal(signingSide({ deal: { side: "BUYER" } }), "BUYER");
  assert.equal(signingSide({ deal: { side: "DUAL" }, agentSide: "SELLER" }), "SELLER", "the WEBForms side when the deal can't say");
  assert.equal(signingSide({ deal: null, agentSide: "DUAL" }), null);
  assert.equal(rememberKey(form, "BUYER"), "lib:AREA0001|BUYER");
  assert.equal(rememberKey(form, null), formKey(form));
  // chosen before choices were per side: kept for the seller side, refused on a buyer deal
  const old = { [formKey(form)]: rememberEntry(form, seller) };
  assert.equal(suggestTemplate(form, [seller, buyer], old, "SELLER").remembered.id, "s");
  const r = suggestTemplate(form, [seller, buyer], old, "BUYER");
  assert.equal(r.remembered, null);
  assert.equal(r.refused.kind, "side");
  assert.match(r.refused.reason, /seller blocks only.*buyers/);
  assert.deepEqual(r.suggestions.map((t) => t.id), ["b"], "the buyer version is offered instead");
  // once the buyer one is chosen on a buyer deal, each side gets its own
  const both = { ...old, [rememberKey(form, "BUYER")]: rememberEntry(form, buyer) };
  assert.equal(suggestTemplate(form, [seller, buyer], both, "BUYER").remembered.id, "b");
  assert.equal(suggestTemplate(form, [seller, buyer], both, "SELLER").remembered.id, "s");
  // side unknown, or a template with both sides' blocks: nothing to refuse
  assert.equal(sideMismatch(seller, null), null);
  assert.equal(sideMismatch({ slots: { BUYER: 1, SELLER: 1 } }, "BUYER"), null);
  assert.equal(sideMismatch({ slots: { BUYER: 0, SELLER: 0, AGENT: 2 } }, "BUYER"), null, "agent-only: not a client-side mismatch");
});

test("addresses: tabs, spelled-out types and unit marks normalise", () => {
  assert.equal(normalizeAddress("\t120  Example Street, N.W."), "120 EXAMPLE ST NW");
  assert.equal(addressScore("120 Example Street, N.W.", "120 Example St NW"), 1);
  assert.equal(addressScore("120 Example Street NW", "120 EXAMPLE ST NW"), 1);
  assert.equal(addressScore("120 Example Street NW", "121 Example Street NW"), 0);
});

test("rankDeals puts the right deal first and still returns all of them", () => {
  const r = rankDeals("120 Example St NW", sampleDeals);
  assert.equal(r[0].deal.id, "d1");
  assert.equal(r.length, sampleDeals.length);
});

test("wrong-deal guard flags another agent's deal and a different address", () => {
  const w = wrongDealWarnings({ webformsAddress: "120 Example St NW", webformsAgentName: "Alex Example", deal: sampleDeals[1] });
  assert.equal(w.length, 2);
  assert.deepEqual(wrongDealWarnings({ webformsAddress: "120 Example St NW", webformsAgentName: "Alex Example", deal: sampleDeals[0] }), []);
});

test("remembered templates: new entries carry names, old ids still work, per-form keys are dropped", () => {
  const t = { id: "a", name: "Both Agency template", pagesCount: 4 };
  const form = { name: "Agreement to Represent Both.pdf", library: "AREA0287", pageCount: 4 };
  const entry = rememberEntry(form, t, 1);
  assert.deepEqual(entry, { id: "a", template: "Both Agency template", form: "Agreement to Represent Both", at: 1 });
  assert.equal(suggestTemplate(form, [t], { [formKey(form)]: entry }).remembered.id, "a", "new shape");
  assert.equal(suggestTemplate(form, [t], { [formKey(form)]: "a" }).remembered.id, "a", "a bare id from before still works");
  assert.equal(rememberedId(null), null);
  const pruned = pruneRemembered({ "guid:x": "a", "lib:AREA0287": entry, "name:addendum": "b", "lib:BAD": { nope: 1 } });
  assert.deepEqual(Object.keys(pruned).sort(), ["lib:AREA0287", "name:addendum"]);
});
