import { test } from "node:test";
import assert from "node:assert/strict";
import { readDocusignTemplate, guessRole, guessRoles, roleBlocks, leftOutText, buildTemplate } from "../src/lib/docusign.js";

// The export's shape (every value a string), invented content. Positions are the ones a
// 6-page AREA purchase contract's DocuSign template used, which is how BLOCKS was measured.
const tab = (page, x, y, over = {}) => ({ documentId: "11", pageNumber: String(page), xPosition: String(x), yPosition: String(y), optional: "false", ...over });
const exportJson = (over = {}) => ({
  name: "Purchase Contract - 2 signers",
  documents: [{ documentId: "11", name: "Purchase Contract.pdf", pages: "6", documentBase64: "JVBERi0=" }],
  recipients: {
    signers: [
      { recipientId: "1", roleName: "Buyer 1", routingOrder: "1", tabs: {
        signHereTabs: [tab(6, 37, 129)], initialHereTabs: [tab(1, 375, 701), tab(5, 459, 633)],
        dateSignedTabs: [tab(6, 255, 123)], textTabs: [tab(1, 100, 100), tab(1, 100, 120)] } },
      { recipientId: "2", roleName: "Buyer 2", routingOrder: "1", tabs: {
        signHereTabs: [tab(6, 37, 179)], initialHereTabs: [tab(1, 426, 701, { optional: "true" })],
        checkboxTabs: [tab(2, 50, 50)] } },
    ],
    carbonCopies: [{ recipientId: "3", roleName: "Office", tabs: {} }],
  },
  ...over,
});

test("reads an export, with a byte-order mark too", () => {
  const p = readDocusignTemplate("﻿" + JSON.stringify(exportJson()));
  assert.equal(p.name, "Purchase Contract - 2 signers");
  assert.deepEqual(p.documents.map((d) => [d.id, d.pages]), [["11", 6]]);
  assert.deepEqual(p.roles.map((r) => r.roleName), ["Buyer 1", "Buyer 2"], "carbon copies don't sign");
  assert.throws(() => readDocusignTemplate({ name: "x" }), /not a template file this can read/);
  assert.throws(() => readDocusignTemplate({ documents: [], recipients: {} }), /no document/);
});

test("role names → Real Signature signers", () => {
  const g = (s) => guessRole(s);
  assert.deepEqual(g("Buyer 1"), { signeeType: "BUYER", signeeIndex: 0 });
  assert.deepEqual(g("Buyer 2"), { signeeType: "BUYER", signeeIndex: 1 });
  assert.deepEqual(g("Purchaser"), { signeeType: "BUYER", signeeIndex: 0 });
  assert.deepEqual(g("Co-Buyer"), { signeeType: "BUYER", signeeIndex: 1 });
  assert.deepEqual(g("Seller #2"), { signeeType: "SELLER", signeeIndex: 1 });
  assert.deepEqual(g("Vendor"), { signeeType: "SELLER", signeeIndex: 0 });
  assert.deepEqual(g("Buyer's Agent"), { signeeType: "BUYERS_AGENT", signeeIndex: 0 });
  assert.deepEqual(g("Listing Agent"), { signeeType: "SELLERS_AGENT", signeeIndex: 0 });
  assert.deepEqual(g("Seller’s Realtor"), { signeeType: "SELLERS_AGENT", signeeIndex: 0 });
  assert.deepEqual(g("Agent"), { agent: true }, "which side is the agent's choice");
  assert.equal(g("Witness"), null);
  assert.equal(g("Contractor"), null, "'co' inside a word isn't a co-signer");
  // Two roles never share a slot.
  assert.deepEqual(guessRoles([{ key: "a", roleName: "Buyer" }, { key: "b", roleName: "Buyer 1" }, { key: "c", roleName: "Agent" }]),
    { a: { signeeType: "BUYER", signeeIndex: 0 }, b: { signeeType: "BUYER", signeeIndex: 1 }, c: null });
});

test("what can't come across is counted, not dropped silently", () => {
  const p = readDocusignTemplate(exportJson());
  const one = roleBlocks(p.roles[0], "11");
  assert.equal(one.blocks.length, 6, "signature, 2 initials, date, 2 text boxes");
  assert.deepEqual(one.left, {});
  assert.deepEqual(roleBlocks(p.roles[1], "11").left, {}, "a checkbox comes over too");
  const locked = roleBlocks({ tabs: { textTabs: [tab(1, 0, 0, { locked: "true", value: "Calgary" })] } }, "11");
  assert.deepEqual(locked, { blocks: [], left: { "locked text field": 1 } }, "the sender's own wording isn't a field to fill");
  const anchored = roleBlocks({ tabs: { signHereTabs: [tab(1, 0, 0, { anchorString: "/sig/" })] } }, "11");
  assert.deepEqual(anchored, { blocks: [], left: { "anchored signature": 1 } });
  assert.equal(leftOutText({ "text field": 2, checkbox: 1 }), "2 text fields, 1 checkbox");
  assert.equal(leftOutText({ checkbox: 2 }), "2 checkboxes");
});

test("positions: top-left points → Real's bottom-left boxes, on the form's lines", () => {
  const p = readDocusignTemplate(exportJson());
  const t = buildTemplate(p, "11", guessRoles(p.roles));
  assert.equal(t.name, "Purchase Contract - 2 signers");
  assert.equal(t.pagesCount, 6);
  const at = (type, signeeIndex, page) => t.fieldDefinitions.find((f) => f.type === type && f.signeeIndex === signeeIndex
    && f.fieldLocations[0].pageNum === page).fieldLocations[0].position;
  // The same form placed by hand in Real Signature: signature [36.8, 631.8, 186.8, 652.8],
  // initials [373.6, 52.6, 413.6, 77.6] — within half a point.
  assert.deepEqual(at("SIGNATURE", 0, 6), [37, 632, 187, 653]);
  assert.deepEqual(at("INITIALS", 0, 1), [375, 53, 415, 78]);
  assert.deepEqual(at("SIGNED_DATE", 0, 6), [255, 648, 320, 669], "DocuSign's date signed carries the time: Date & Time");
  assert.deepEqual(t.fieldDefinitions.map((f) => f.index), t.fieldDefinitions.map((_, i) => i));
  assert.deepEqual(t.signeeConfigs, [{ signeeType: "BUYER", minNum: 0, maxNum: 2 }]);
  // Optional in DocuSign → not required in Real; everything else required.
  const optional = t.fieldDefinitions.find((f) => f.signeeIndex === 1 && f.type === "INITIALS").index;
  // 9 fields: one optional initials, and two text boxes and a checkbox that don't say required.
  assert.equal(t.documentFieldValidations.length, t.fieldDefinitions.length - 4);
  assert.ok(!t.documentFieldValidations.some((v) => v.fieldIndex === optional));
  assert.deepEqual(t.fieldDefinitions.filter((f) => f.type === "INITIALS").map((f) => f.displayName), ["Initials 1", "Initials 2", "Initials 3"]);
});

test("a role left out brings nothing; the agent's side is a choice", () => {
  const p = readDocusignTemplate(exportJson());
  const t = buildTemplate(p, "11", { 1: { signeeType: "BUYER", signeeIndex: 0 }, 2: null });
  assert.ok(t.fieldDefinitions.every((f) => f.signeeIndex === 0));
  assert.deepEqual(t.signeeConfigs, [{ signeeType: "BUYER", minNum: 0, maxNum: 1 }]);
  const asAgent = buildTemplate(p, "11", { 1: { signeeType: "BUYER", signeeIndex: 0 }, 2: { signeeType: "BUYERS_AGENT", signeeIndex: 0 } });
  assert.deepEqual(asAgent.signeeConfigs.map((c) => c.signeeType).sort(), ["BUYER", "BUYERS_AGENT"]);
});

test("refuses rather than guessing", () => {
  const p = readDocusignTemplate(exportJson());
  const same = { 1: { signeeType: "BUYER", signeeIndex: 0 }, 2: { signeeType: "BUYER", signeeIndex: 0 } };
  assert.throws(() => buildTemplate(p, "11", same), /same signer/);
  assert.throws(() => buildTemplate(p, "11", { 1: null, 2: null }), /no signature, initials or date blocks/);
  const offPage = readDocusignTemplate(exportJson({ recipients: { signers: [{ recipientId: "1", roleName: "Buyer", tabs: { signHereTabs: [tab(1, 37, 900)] } }] } }));
  assert.throws(() => buildTemplate(offPage, "11", { 1: { signeeType: "BUYER", signeeIndex: 0 } }), /below the bottom of a letter-size page/);
  const noPages = readDocusignTemplate(exportJson({ documents: [{ documentId: "11", name: "x.pdf", documentBase64: "" }] }));
  assert.throws(() => buildTemplate(noPages, "11", guessRoles(noPages.roles)), /how many pages/);
});

test("names and text boxes: the signer's name filled by Real, boxes the signer types in", () => {
  // The shape of a one-page consent form: printed name, phone and email lines.
  const p = readDocusignTemplate(exportJson({ recipients: { signers: [{ recipientId: "1", roleName: "Buyer 1", tabs: {
    signHereTabs: [tab(1, 82, 395)],
    fullNameTabs: [tab(1, 79, 431, { width: "0", height: "0" })],
    textTabs: [tab(1, 113, 468, { width: "287", height: "22", required: "true", locked: "false", value: "" }),
               tab(1, 114, 488, { width: "288", height: "19", required: "false", locked: "false" })],
  } }] } }));
  const t = buildTemplate(p, "11", { 1: { signeeType: "BUYER", signeeIndex: 0 } });
  const f = (type) => t.fieldDefinitions.filter((x) => x.type === type);
  assert.deepEqual(f("SIGNEE_NAME")[0].fieldLocations[0].position, [79, 346, 229, 361], "0×0 in DocuSign → Real's 150×15");
  assert.deepEqual(f("STRING").map((x) => x.fieldLocations[0].position), [[113, 302, 400, 324], [114, 285, 402, 304]], "DocuSign's own box size");
  assert.deepEqual(f("STRING").map((x) => x.displayName), ["Text 1", "Text 2"]);
  assert.ok(f("STRING").every((x) => x.signeeType === "BUYER" && x.defaultValue === null));
  const required = new Set(t.documentFieldValidations.map((v) => v.fieldIndex));
  assert.ok(required.has(f("STRING")[0].index) && !required.has(f("STRING")[1].index), "text boxes say required, not optional");
});

test("radio buttons and checkboxes, with their group rules as Real's editor saves them", () => {
  const p = readDocusignTemplate(exportJson({ recipients: { signers: [{ recipientId: "1", roleName: "Seller 1", tabs: {
    signHereTabs: [tab(5, 37, 545)],
    radioGroupTabs: [
      { documentId: "11", groupName: "Fee", radios: [{ pageNumber: "2", xPosition: "478", yPosition: "658", required: "true" }, { pageNumber: "2", xPosition: "519", yPosition: "659", required: "true" }] },
      { documentId: "11", groupName: "Maybe", radios: [{ pageNumber: "2", xPosition: "478", yPosition: "678", required: "false" }, { pageNumber: "2", xPosition: "519", yPosition: "678", required: "false" }] },
      { documentId: "11", groupName: "Pinned", radios: [{ pageNumber: "2", anchorString: "/r/" }] },
    ],
    checkboxTabs: [
      tab(4, 470, 295, { tabGroupLabels: ["Media"] }), tab(4, 470, 305, { tabGroupLabels: ["Media"] }),
      tab(4, 512, 295, { required: "true" }), tab(4, 512, 305, { required: "false" }),
    ],
    tabGroups: [{ groupLabel: "Media", groupRule: "SelectAtLeast", minimumRequired: "1", maximumAllowed: "2" }],
  } }] } }));
  const role = p.roles[0];
  assert.deepEqual(roleBlocks(role, "11").left, { "radio group": 1 }, "an anchored group can't be placed; tabGroups aren't fields");
  const t = buildTemplate(p, "11", { 1: { signeeType: "SELLER", signeeIndex: 0 } });
  const of = (type) => t.fieldDefinitions.filter((f) => f.type === type);
  assert.equal(of("RADIO").length, 4);
  assert.equal(of("BOOLEAN").length, 4);
  assert.deepEqual(of("RADIO")[0].fieldLocations[0], { position: [481, 121, 491, 131], pageNum: 2 }, "10×10, centred on DocuSign's bigger tick");
  assert.deepEqual(of("RADIO").map((f) => f.displayName), ["Radio 1", "Radio 2", "Radio 3", "Radio 4"]);
  const v = (type) => t.documentFieldValidations.filter((x) => x.validationType === type);
  assert.deepEqual(v("REQUIRED_ONLY_ONE"), [{ validationType: "REQUIRED_ONLY_ONE", fieldIndex: null, relatedFieldIndexes: of("RADIO").slice(0, 2).map((f) => f.index) }],
    "a required radio group: exactly one; an optional one: no rule");
  assert.deepEqual(v("REQUIRED_AT_LEAST_ONE")[0].relatedFieldIndexes, of("BOOLEAN").slice(0, 2).map((f) => f.index));
  const requiredOne = v("REQUIRED").map((x) => x.fieldIndex);
  assert.ok(requiredOne.includes(of("BOOLEAN")[2].index) && !requiredOne.includes(of("BOOLEAN")[3].index), "a lone checkbox keeps its own required");
  assert.ok(!of("BOOLEAN").slice(0, 2).some((f) => requiredOne.includes(f.index)), "grouped boxes follow the group's rule only");
});

test("a template with two documents names each one", () => {
  const two = exportJson();
  two.documents.push({ documentId: "12", name: "Schedule.pdf", pages: "1", documentBase64: "JVBERi0=" });
  two.recipients.signers[0].tabs.signHereTabs.push(tab(1, 40, 600, { documentId: "12" }));
  const p = readDocusignTemplate(two);
  const s = buildTemplate(p, "12", guessRoles(p.roles));
  assert.equal(s.name, "Purchase Contract - 2 signers – Schedule");
  assert.equal(s.fieldDefinitions.length, 1);
  assert.equal(s.pagesCount, 1);
});
