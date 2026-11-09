import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { checkDocument, checkPacket, reviewLines, reviewTitle, slotName } from "../src/lib/review.js";
import { stepFromPage, stepFromUrl, stepName, shouldClose } from "../src/lib/steps.js";

// A document as GET /document-templates/{id} has it on Review: signers saved by Edit
// details, blocks by Prepare. Invented people only.
const jordan = { name: "Jordan Sample", email: "jordan@example.com", signeeType: "BUYER", signeeIndex: 0, signOrder: 1 };
const riley = { name: "Riley Sample", email: "riley@example.com", signeeType: "BUYER", signeeIndex: 1, signOrder: 1 };
const casey = { name: "Casey Example", email: "casey@example.com", signeeType: "SELLER", signeeIndex: 0, signOrder: 1 };
const agent = { name: "Sam Agent", email: "agent@example.com", signeeType: "BUYERS_AGENT", signeeIndex: 0, signOrder: 2 };
let n = 0;
const f = (type, signeeType, signeeIndex, page = 1) => ({ index: n++, type, signeeType, signeeIndex,
  fieldLocations: [{ pageNum: page, position: [100, 100, 250, 121] }] });
const doc = (signees, fields, extra = {}) => ({
  id: "d1", name: "Offer", oneTimeUse: true, fieldDefinitions: fields,
  signeeConfigs: [...new Set(signees.map((s) => s.signeeType))].map((signeeType) => ({ signeeType })),
  defaults: { transactionId: null, signees, sender: { email: "agent@example.com" } }, ...extra,
});
const kinds = (r) => r.items.map((i) => `${i.kind}:${i.slot || ""}`);

test("Real's own slot names", () => {
  assert.equal(slotName("BUYER", 0), "Buyer 1");
  assert.equal(slotName("SELLERS_AGENT", 0), "Sellers Agent 1");
  assert.equal(slotName("SELLER", 1), "Seller 2");
});

test("a document with every signer emailed, signing and dated is ready", () => {
  const r = checkDocument(doc([jordan, agent], [f("SIGNATURE", "BUYER", 0), f("SIGNED_DATE", "BUYER", 0),
    f("SIGNATURE", "BUYERS_AGENT", 0, 2), f("SIGNED_DATE_ONLY", "BUYERS_AGENT", 0, 2), f("INITIALS", "BUYER", 0, 3)]));
  assert.equal(r.ready, true);
  assert.deepEqual(r.items, []);
  assert.deepEqual(reviewLines(r), []);
  assert.equal(reviewTitle(r), null);
});

test("a signer with no email, or one that isn't an email", () => {
  const r = checkDocument(doc([{ ...jordan, email: "  " }, { ...casey, email: "Casey Example" }],
    [f("SIGNATURE", "BUYER", 0), f("SIGNED_DATE", "BUYER", 0), f("SIGNATURE", "SELLER", 0), f("SIGNED_DATE", "SELLER", 0)]));
  assert.deepEqual(kinds(r), ["no-email:Buyer 1", "bad-email:Seller 1"]);
  const lines = reviewLines(r);
  assert.match(lines[0], /^Buyer 1 \(Jordan Sample\) has no email\. Add it in Add Signees\.$/);
  assert.match(lines[1], /Seller 1 \(Casey Example\)'s email doesn't look like an email/);
});

test("a signer with no signature block (initials alone don't count)", () => {
  const r = checkDocument(doc([jordan, riley], [f("SIGNATURE", "BUYER", 0), f("SIGNED_DATE", "BUYER", 0), f("INITIALS", "BUYER", 1)]));
  assert.deepEqual(kinds(r), ["no-signature:Buyer 2"]);
  assert.match(reviewLines(r)[0], /^Buyer 2 \(Riley Sample\) has no signature block\. Add one on Prepare/);
});

test("a signature with no date on its page", () => {
  const r = checkDocument(doc([jordan, casey], [
    f("SIGNATURE", "BUYER", 0, 1), f("SIGNED_DATE", "BUYER", 0, 1),
    f("SIGNATURE", "BUYER", 0, 4), // page 4: no date
    f("SIGNATURE", "SELLER", 0, 2), f("SIGNED_DATE", "BUYER", 0, 2), // the buyer's date doesn't date the seller
  ]));
  assert.deepEqual(r.items.map((i) => [i.kind, i.slot, i.count]), [["undated", "Buyer 1", 1], ["undated", "Seller 1", 1]]);
  assert.match(reviewLines(r)[0], /Buyer 1 \(Jordan Sample\)'s signature has no date block on the same page/);
});

test("Buyer 2's signature is dated by Buyer 1's shared date line, as Dotted Line places it", () => {
  const r = checkDocument(doc([jordan, riley], [f("SIGNED_DATE", "BUYER", 0, 3), f("SIGNATURE", "BUYER", 0, 3), f("SIGNATURE", "BUYER", 1, 3)]));
  assert.equal(r.ready, true);
  // …but Buyer 2's own date doesn't date Buyer 1.
  const r2 = checkDocument(doc([jordan, riley], [f("SIGNED_DATE", "BUYER", 1, 3), f("SIGNATURE", "BUYER", 0, 3), f("SIGNATURE", "BUYER", 1, 3)]));
  assert.deepEqual(kinds(r2), ["undated:Buyer 1"]);
});

test("nobody to sign, blocks for nobody, and a packet's document on its own", () => {
  assert.deepEqual(kinds(checkDocument(doc([], []))), ["no-signers:"]);
  const r = checkDocument(doc([jordan], [f("SIGNATURE", "BUYER", 0), f("SIGNED_DATE", "BUYER", 0), f("SIGNATURE", "BUYER", 1), f("SIGNATURE", "SENDER", 0)]));
  assert.deepEqual(kinds(r), ["no-signer:Buyer 2"], "a SENDER block is the sender's, never a signer to add");
  assert.match(reviewLines(r)[0], /^Buyer 2 has a signature block but nobody to sign it/);
  const inPacket = checkDocument(doc([jordan], [f("SIGNATURE", "BUYER", 0), f("SIGNED_DATE", "BUYER", 0)], { oneTimeUsePacket: true }));
  assert.deepEqual(kinds(inPacket), ["in-packet:"]);
});

test("signers in a role the document doesn't have are left out, as Real's screens leave them", () => {
  const d = doc([jordan], [f("SIGNATURE", "BUYER", 0), f("SIGNED_DATE", "BUYER", 0)]);
  d.defaults.signees.push({ ...casey, email: "" }); // a stray seller from a removed document
  assert.equal(checkDocument(d).ready, true);
});

test("a document that isn't shaped like one throws, never guesses", () => {
  assert.throws(() => checkDocument(null), /changed shape/);
  assert.throws(() => checkDocument({ fieldDefinitions: "x" }), /changed shape/);
  assert.throws(() => checkDocument(doc([{ name: "Jordan Sample" }], [])), /changed shape/);
  assert.throws(() => checkPacket({ name: "P" }), /packet changed shape/);
});

test("a packet: a signer needs a signature on one document, not all; dates say which document", () => {
  const offer = doc([jordan, agent], [f("SIGNATURE", "BUYER", 0), f("SIGNED_DATE", "BUYER", 0), f("SIGNATURE", "BUYERS_AGENT", 0), f("SIGNED_DATE", "BUYERS_AGENT", 0)], { name: "Offer" });
  const schedule = doc([jordan, agent], [f("SIGNATURE", "BUYER", 0, 2)], { name: "Schedule A" });
  const r = checkPacket({ id: "p1", name: "120 Example Street NW", documentTemplates: [offer, schedule] });
  assert.equal(r.packet, true);
  assert.deepEqual(r.items.map((i) => [i.kind, i.slot, i.doc]), [["undated", "Buyer 1", "Schedule A"]]);
  assert.match(reviewLines(r)[0], /Buyer 1 \(Jordan Sample\)'s signature on Schedule A has no date block/);
  // The agent signs nowhere in the packet → missing once, not once per document.
  const noAgent = checkPacket({ documentTemplates: [doc([jordan, agent], [f("SIGNATURE", "BUYER", 0), f("SIGNED_DATE", "BUYER", 0)]), schedule] });
  assert.deepEqual(kinds(noAgent).filter((k) => k.startsWith("no-signature")), ["no-signature:Buyers Agent 1"]);
  assert.match(reviewLines(noAgent).find((l) => /Agent/.test(l)), /on any document\. Add one on Prepare, or take the agent off/);
  // No email: said once for the packet, though every document carries the signer.
  const noEmail = checkPacket({ documentTemplates: [offer, schedule].map((d) => ({ ...d, defaults: { signees: [{ ...jordan, email: "" }] }, signeeConfigs: [{ signeeType: "BUYER" }] })) });
  assert.equal(kinds(noEmail).filter((k) => k === "no-email:Buyer 1").length, 1);
  assert.deepEqual(kinds(checkPacket({ documentTemplates: [] })), ["no-signers:"]);
});

test("the icon's tooltip counts what's missing, or says the check couldn't run", () => {
  assert.equal(reviewTitle({ items: [{}, {}] }), "Dotted Line: 2 things to check before you send. Click to see them.");
  assert.equal(reviewTitle({ items: [{}] }), "Dotted Line: 1 thing to check before you send. Click to see it.");
  assert.match(reviewTitle(null, { error: true }), /couldn't check/);
});

// ---- which step (steps.js) ----

const RS = "https://signature.therealbrokerage.com/one-time-documents/document/00000000-0000-4000-8000-000000000001";

test("a step's name from a step bar's label", () => {
  assert.equal(stepName("Review"), "review");
  assert.equal(stepName("4Review"), "review");
  assert.equal(stepName("Step 3: Prepare"), "prepare");
  assert.equal(stepName("✓ Edit Details"), "edit-details");
  assert.equal(stepName("Transaction"), "transaction");
  assert.equal(stepName("Review & Send"), "review");
  assert.equal(stepName("Draft"), null);
  assert.equal(stepName("Review the terms of this agreement before signing"), null);
});

test("the step from the address, if Real ever puts it there", () => {
  assert.equal(stepFromUrl(RS), null, "today's address: no step in it");
  assert.equal(stepFromUrl(`${RS}/review`), "review");
  assert.equal(stepFromUrl(`${RS}?step=edit-details`), "edit-details");
  assert.equal(stepFromUrl(`${RS}#prepare`), "prepare");
  assert.equal(stepFromUrl("not a url"), null);
});

test("the step from the page: aria-current first, then a class, then a Send button", () => {
  assert.deepEqual(stepFromPage({ url: RS, marked: [{ text: "Prepare", strong: true }] }), { step: "prepare", by: "marker" });
  // A class can be anything's styling: aria-current wins over it.
  assert.equal(stepFromPage({ url: RS, marked: [{ text: "Review", strong: false }, { text: "Prepare", strong: true }] }).step, "prepare");
  // Done steps keep a mark on some bars: the furthest is where the agent is.
  assert.equal(stepFromPage({ url: RS, marked: [{ text: "Transaction" }, { text: "Edit details" }, { text: "Prepare" }] }).step, "prepare");
  assert.deepEqual(stepFromPage({ url: RS, marked: [{ text: "Sent" }], buttons: ["Back", "Send"] }), { step: "review", by: "send" });
  // Real's own "Send One-time Document" (its home's button) is not Review.
  assert.equal(stepFromPage({ url: RS, buttons: ["Send One-time Document", "Next"] }).step, null);
  assert.deepEqual(stepFromPage({ url: RS }), { step: null, by: null });
  assert.equal(stepFromPage({ url: `${RS}#review`, marked: [{ text: "Prepare", strong: true }] }).step, "review", "the address first");
});

// ---- closing by itself (steps.js shouldClose) ----

const base = { screen: "dr", popup: false, busy: false, error: false, note: false, review: null, prepare: null };

test("closes after Auto place adds blocks, unless there's a note to read", () => {
  assert.equal(shouldClose({ ...base, event: "placed", added: 3 }), true);
  assert.equal(shouldClose({ ...base, event: "placed", added: 0 }), false, "nothing placed: the panel says why");
  assert.equal(shouldClose({ ...base, event: "placed", added: 3, note: true }), false, "lines left for the agent");
  assert.equal(shouldClose({ ...base, event: "placed", added: 3, error: true }), false);
});

test("closes on reaching Prepare with every block there, and on reaching Review with nothing missing", () => {
  assert.equal(shouldClose({ ...base, event: "step", step: "prepare", prepare: { full: true } }), true);
  assert.equal(shouldClose({ ...base, event: "step", step: "prepare", prepare: { full: false } }), false);
  assert.equal(shouldClose({ ...base, event: "step", step: "prepare" }), false, "not known: stays");
  assert.equal(shouldClose({ ...base, screen: "rv", event: "step", step: "review", review: { ready: true } }), true);
  assert.equal(shouldClose({ ...base, screen: "rv", event: "step", step: "review", review: { ready: false }, note: true }), false, "the check's result is the note");
  assert.equal(shouldClose({ ...base, screen: "rv", event: "step", step: "review", review: { ready: false } }), false);
  assert.equal(shouldClose({ ...base, screen: "rv", event: "step", step: "review", error: true }), false, "a check that couldn't run");
  assert.equal(shouldClose({ ...base, event: "step", step: "edit-details" }), false, "Back to Edit details");
});

test("never closes when the agent opened it, on a choice, a summary, a popup or work under way", () => {
  assert.equal(shouldClose({ ...base, screen: "rv", event: "opened", step: "review", review: { ready: true } }), false, "the icon always brings it back");
  assert.equal(shouldClose({ ...base, screen: "rs", event: "step", step: "prepare", prepare: { full: true } }), false, "Set up waiting");
  assert.equal(shouldClose({ ...base, screen: "made", event: "step", step: "prepare", prepare: { full: true } }), false, "one-click summary");
  assert.equal(shouldClose({ ...base, popup: true, event: "placed", added: 2 }), false);
  assert.equal(shouldClose({ ...base, busy: true, event: "placed", added: 2 }), false);
  assert.equal(shouldClose({}), false);
});

// ---- the page is read, never touched ----

test("the step watcher in the Real Signature tab only reads the page, and never presses Send", () => {
  const src = readFileSync(new URL("../src/realsig/content.js", import.meta.url), "utf8");
  const start = src.indexOf("// ---- which step the document is on");
  const end = src.indexOf("// Next on a draft's steps");
  assert.ok(start > 0 && end > start, "the watcher's section is where this test expects it");
  const watcher = src.slice(start, end);
  for (const touch of [/\.click\(/, /\.append(Child)?\(/, /\.remove\(/, /setAttribute\(/, /\.innerHTML\s*=/, /\.textContent\s*=/, /\.style\./, /dispatchEvent\(/, /\.focus\(/, /putDraft|deleteDraft|createPacketDraft|uploadDraft/]) {
    assert.ok(!touch.test(watcher), `the step watcher must not ${touch}`);
  }
  // The check reads the draft with GETs only.
  assert.match(watcher, /rs\.getPacketDraft\(id\)/);
  assert.match(watcher, /rs\.getTemplate\(id\)/);
});

test("rs:step and rs:no-step are taken from the Real Signature tab only", () => {
  const bg = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const rsOnly = JSON.parse(`[${/RS_TAB_ONLY = new Set\(\[([^\]]*)\]\)/.exec(bg)[1]}]`);
  assert.ok(rsOnly.includes("rs:step") && rsOnly.includes("rs:no-step"));
});

test("the dry run Auto place uses on Prepare saves nothing", () => {
  const src = readFileSync(new URL("../src/realsig/content.js", import.meta.url), "utf8");
  assert.match(src, /if \(added && !dryRun\) await rs\.putDraft\(id, body\);/);
});
