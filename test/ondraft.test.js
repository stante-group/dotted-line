import test from "node:test";
import assert from "node:assert/strict";

import { draftSigners, placeOnDraft, sameSpot } from "../src/lib/ondraft.js";
import { RealSignature } from "../src/lib/realsig-api.js";
import { addressInText } from "../src/lib/deals.js";
import { confidentDeal, scoresFromText } from "../src/lib/auto.js";
import { sanitizeReport } from "../src/lib/report.js";

// A draft as Real Signature has it after Edit details' Next (2026-10-30): signers and
// signeeConfigs saved, no blocks, pagesCount still null. Invented people only.
const draft = (signees, extra = {}) => ({
  id: "d1", name: "Offer.pdf", type: "USER_PDF", draft: true, oneTimeUse: true, pagesCount: null,
  fieldDefinitions: [], documentFieldValidations: [],
  signeeConfigs: [...new Set(signees.map((s) => s.signeeType))].map((signeeType) => ({ signeeType, minNum: 0, maxNum: signees.filter((s) => s.signeeType === signeeType).length })),
  defaults: { transactionId: null, signees, recipients: [], sender: { email: "agent@example.com" }, emailSubject: null, emailBody: "" },
  ...extra,
});
const casey = { name: "Casey Example", email: "casey@example.com", signeeType: "SELLER", signeeIndex: 0, signOrder: 1 };
const jordan = { name: "Jordan Sample", email: "jordan@example.com", signeeType: "BUYER", signeeIndex: 0, signOrder: 1 };
const agent = { name: "Sam Agent", email: "agent@example.com", signeeType: "SELLERS_AGENT", signeeIndex: 0, signOrder: 1 };

const block = (index, signeeType, signeeIndex, page, x, y, type = "SIGNATURE") => ({
  index, type, signeeType, signeeIndex, formatting: { fontSize: 12, rotationAngle: 0 },
  fieldLocations: [{ pageNum: page, position: [x, y, x + 150, y + 21] }], displayName: `${type} ${index + 1}`, defaultValue: null, readonly: false,
});
// What autoLayout finds on an offer: both buyers, both sellers, a client line, both agents
// and the generic brokerage line.
const found = () => {
  const f = [
    block(0, "BUYER", 0, 2, 50, 300), block(1, "BUYER", 1, 2, 300, 300),
    block(2, "SELLER", 0, 2, 50, 200), block(3, "SELLER", 1, 2, 300, 200),
    block(4, "BUYERS_AGENT", 0, 3, 50, 400), block(5, "SELLERS_AGENT", 0, 3, 50, 300),
    block(6, "AGENT", 0, 3, 50, 200), block(7, "CLIENT", 0, 1, 50, 100, "INITIALS"),
  ];
  return { pagesCount: 3, fieldDefinitions: f, signeeConfigs: [],
    documentFieldValidations: f.map((x) => ({ validationType: "REQUIRED", fieldIndex: x.index, relatedFieldIndexes: [] })) };
};
const slots = (body) => body.fieldDefinitions.map((f) => `${f.signeeType}/${f.signeeIndex}@${f.fieldLocations[0].pageNum}`).sort();

test("signers come from the draft's own Edit details, and nobody named means not yet", () => {
  assert.equal(draftSigners(draft([])), null);
  assert.equal(draftSigners({ defaults: null }), null);
  assert.deepEqual(draftSigners(draft([casey])), { counts: { SELLER: 1 }, agentRole: null, total: 1 });
  assert.equal(draftSigners(draft([casey, agent])).agentRole, "SELLERS_AGENT");
  assert.equal(draftSigners(draft([casey, agent, { ...agent, signeeType: "BUYERS_AGENT" }])).agentRole, "both");
  assert.throws(() => draftSigners(draft([{ name: "x" }])), /changed shape/);
  assert.throws(() => placeOnDraft(draft([]), found(), 3), /no signers/);
});

test("an offer from the other side: only the named seller gets blocks, the buyers' lines stay empty", () => {
  const { body, added, skipped } = placeOnDraft(draft([casey]), found(), 3);
  // Seller 1's line, and the client initials as the seller's (the only side signing).
  assert.deepEqual(slots(body), ["SELLER/0@1", "SELLER/0@2"]);
  assert.equal(added, 2);
  assert.equal(skipped, 0);
  assert.equal(body.pagesCount, 3, "pagesCount is null after upload and is set from the PDF");
  assert.deepEqual(body.documentFieldValidations.map((v) => v.fieldIndex), [0, 1]);
  // A full replace: the signers, sender and configs go back exactly as they were.
  assert.deepEqual(body.defaults, draft([casey]).defaults);
  assert.deepEqual(body.signeeConfigs, draft([casey]).signeeConfigs);
});

test("the agent's lines when the agent is a signer: the generic brokerage line becomes theirs", () => {
  const { body } = placeOnDraft(draft([casey, agent]), found(), 3);
  assert.deepEqual(slots(body), ["SELLER/0@1", "SELLER/0@2", "SELLERS_AGENT/0@3", "SELLERS_AGENT/0@3"]);
  const dual = placeOnDraft(draft([casey, jordan, agent, { ...agent, signeeType: "BUYERS_AGENT" }]), found(), 3).body;
  // Both agents: each side's own line; the generic one can't be told apart and comes off.
  assert.deepEqual(slots(dual), ["BUYER/0@2", "BUYERS_AGENT/0@3", "SELLER/0@2", "SELLERS_AGENT/0@3"]);
});

test("blocks already on the draft stay, and pressing it twice adds nothing", () => {
  const mine = block(0, "SELLER", 0, 2, 52, 201); // placed by hand, almost on the same spot
  const extra = block(1, "SELLER", 0, 1, 400, 700, "INITIALS");
  const d = draft([casey], { fieldDefinitions: [mine, extra],
    documentFieldValidations: [{ validationType: "REQUIRED", fieldIndex: 0, relatedFieldIndexes: [] }] });
  const first = placeOnDraft(d, found(), 3);
  assert.equal(first.added, 1, "the client initials only: the signature line already has a block");
  assert.equal(first.skipped, 1);
  assert.deepEqual(first.body.fieldDefinitions.slice(0, 2), [mine, extra]);
  assert.equal(first.body.fieldDefinitions[2].index, 2);
  assert.deepEqual(first.body.documentFieldValidations.map((v) => v.fieldIndex), [0, 2]);
  const again = placeOnDraft(first.body, found(), 3);
  assert.equal(again.added, 0);
  assert.deepEqual(again.body.fieldDefinitions, first.body.fieldDefinitions);
});

test("a form with nothing found leaves the draft as it was", () => {
  const { body, added } = placeOnDraft(draft([casey]), null, 2);
  assert.equal(added, 0);
  assert.deepEqual(body.fieldDefinitions, []);
});

test("same spot: same page and over half the smaller block shared", () => {
  assert.ok(sameSpot(block(0, "SELLER", 0, 1, 50, 100), block(1, "BUYER", 0, 1, 100, 105)));
  assert.ok(!sameSpot(block(0, "SELLER", 0, 1, 50, 100), block(1, "SELLER", 0, 2, 50, 100)));
  assert.ok(!sameSpot(block(0, "SELLER", 0, 1, 50, 100), block(1, "SELLER", 0, 1, 50, 130)));
});

test("the draft's PDF: Real's file link, then S3 with no sign-in sent along", async () => {
  const seen = [];
  const pdf = new TextEncoder().encode("%PDF-1.4 test");
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, init });
    if (url.includes("/file-url")) return { ok: true, status: 200, text: async () => JSON.stringify({ url: "https://prod-signature-files.s3.amazonaws.com/x.pdf?X-Amz-Signature=abc", attachmentUrl: null }) };
    return { ok: true, status: 200, arrayBuffer: async () => pdf.buffer };
  };
  const bytes = await new RealSignature({ getToken: () => "tok", fetchImpl }).draftPdf("d1");
  assert.deepEqual(bytes, pdf);
  assert.ok(seen[0].url.endsWith("/document-templates/d1/file-url"));
  assert.equal(seen[0].init.headers.Authorization, "Bearer tok");
  assert.equal(seen[1].init.headers, undefined, "the bearer token never goes to S3");
});

test("a file link that isn't Real's S3 storage is refused, not fetched", async () => {
  for (const url of ["http://prod-signature-files.s3.amazonaws.com/x.pdf", "https://example.com/x.pdf", "https://s3.amazonaws.com.example.com/x", null]) {
    const seen = [];
    const fetchImpl = async (u) => { seen.push(u); return { ok: true, status: 200, text: async () => JSON.stringify({ url }) }; };
    await assert.rejects(new RealSignature({ getToken: () => "t", fetchImpl }).draftPdf("d1"), /changed shape/);
    assert.equal(seen.length, 1);
  }
});

// ---- the deal, from the uploaded PDF's text ----

const offerLines = [
  "RESIDENTIAL PURCHASE CONTRACT",
  "Buyer: Jordan Sample   Seller: Casey Example",
  "Municipal address: 120 Example Street N.W., Calgary, Alberta",
  "Purchase price $500,000. Deposit of $120 paid on 2026-10-30.",
];
const deal = (id, address, kind = "deal") => ({ id, kind, address, side: kind === "listing" ? "SELLER" : "BUYER", participants: [] });

test("a deal's street address is found in the form's text, spelled as the form spells it", () => {
  const text = offerLines.join("\n");
  assert.equal(addressInText("120 Example Street NW, Calgary, AB T2T 2T2", text), 1);
  assert.equal(addressInText("120 Example St NW", text), 1);
  // Same digits elsewhere (the $120 deposit), different street: no match.
  assert.ok(addressInText("120 Other Road SW, Calgary", text) <= 0.5);
  // Same street, different house: not this deal.
  assert.equal(addressInText("122 Example Street NW", text), 0);
  assert.equal(addressInText("", text), 0);
  // A unit written 204-1234 on the form.
  assert.equal(addressInText("204 1234 Sample Avenue SW", "Unit 204-1234 Sample Ave. S.W."), 1);
});

test("the deal is picked from the text by the same rules as a WEBForms address", () => {
  const deals = [deal("a", "120 Example Street NW, Calgary"), deal("b", "44 Sample Crescent SE, Calgary", "listing"),
    { id: "r", kind: "buyer", address: "", buyerNames: ["Riley Nobody"], participants: [] }];
  const picked = confidentDeal(null, deals, [], scoresFromText(offerLines, deals));
  assert.equal(picked.deal.id, "a");
  assert.equal(picked.by, "address");
  // Nothing on the form matches: No deal by default, said so.
  const none = confidentDeal(null, deals, [], scoresFromText(["A FORM WITH NO ADDRESS ON IT AT ALL"], deals));
  assert.equal(none.deal, null);
  assert.equal(none.by, "none");
  // The same address twice (a listing and the deal it became): the agent picks.
  const tie = confidentDeal(null, [...deals, deal("c", "120 Example Street NW", "listing")], [], scoresFromText(offerLines, [...deals, deal("c", "120 Example Street NW", "listing")]));
  assert.equal(tie.deal, null);
  // A Buyer Record by the buyer's whole name on one line.
  const rec = { id: "r2", kind: "buyer", address: "", buyerNames: ["Jordan Sample"], participants: [] };
  const byName = confidentDeal(null, [rec], [], scoresFromText(offerLines, [rec]));
  assert.equal(byName.deal.id, "r2");
  assert.equal(byName.by, "name");
});

test("its reports: the new step, path and route word survive; nothing else changes", () => {
  const r = sanitizeReport({ kind: "error", step: "on-draft", cls: "changed-shape", code: "changed-shape", version: "0.3.0", chrome: "141",
    route: "GET /document-templates/{id}/file-url", ctx: { path: "draft", forms: "1" } });
  assert.equal(r.step, "on-draft");
  assert.equal(r.route, "GET /document-templates/{id}/file-url");
  assert.equal(r.ctx.path, "draft");
});

test("an uploaded draft's title and subject: the form from the file name, the place from the deal", async () => {
  const { formNameFromFile, draftTitleValues, draftTitle, subjectFor, DEFAULT_SETTINGS } = await import("../src/lib/pattern.js");
  assert.equal(formNameFromFile("3. Signed-Residential_Purchase_Contract (2).pdf"), "Residential Purchase Contract");
  assert.equal(formNameFromFile("CPS - Residential Contract.pdf"), "CPS - Residential Contract");
  assert.equal(formNameFromFile(".pdf"), "Form");
  const now = new Date(2026, 9, 30);
  const d = { address: "120 Example Street NW, Calgary, AB T2T 2T2", mlsNum: "A0000000" };
  const v = draftTitleValues({ fileName: "Residential Purchase Contract.pdf", deal: d, now });
  assert.equal(v.address, "120 Example Street NW, Calgary");
  assert.equal(draftTitle(v), "120 Example Street NW – Residential Purchase Contract");
  const pattern = { ...DEFAULT_SETTINGS, subjectMode: "pattern" };
  assert.equal(subjectFor(pattern, v, draftTitle(v)), "Please sign: Residential Purchase Contract – 120 Example Street NW, Calgary");
  // No deal: the form still says what to sign — not a bare "Please sign".
  const none = draftTitleValues({ fileName: "Residential Purchase Contract.pdf", now });
  assert.equal(subjectFor(pattern, none, draftTitle(none)), "Please sign: Residential Purchase Contract");
  assert.equal(draftTitle(none), "Residential Purchase Contract");
});
