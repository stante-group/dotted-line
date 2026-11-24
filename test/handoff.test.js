// "Start as soon as I click the Dotted Line icon" with one click off (issue #11): the
// worker makes the hand-off the popup used to, from the same picks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startsFromClick, notReady, samePicks, detailsRequest, webformsHandoff, handoffMeta } from "../src/lib/handoff.js";
import { DEFAULT_SETTINGS } from "../src/lib/pattern.js";

const dealPicks = {
  source: "deal", transactionId: "T-1", user: { name: "Jordan Sample", email: null },
  transaction: { Name: "Sample purchase", Address: null, StreetNumber: "120", StreetName: "Example Street NW", City: "Calgary", MLSNumber: null, UnitNumber: null },
  forms: [{ id: "F1", name: "Offer", transactionId: "T-1", lastModified: null }, { id: "F2", name: "Schedule A", transactionId: "T-1", lastModified: null }],
};
const details = {
  userName: "Jordan Sample", userEmail: "jordan@example.com", transaction: dealPicks.transaction,
  forms: [{ id: "F1", typeName: "Residential Purchase Contract", library: "AB1", pageCount: 9 }, { id: "F2", typeName: "Schedule A", pageCount: 1 }],
  buyerNames: ["Riley Sample"], agentSide: "BUYER", parties: { BUYER: 1, SELLER: 0 }, contactPeople: [],
};

test("only start-on-click with one click OFF starts from the click: one click keeps its popup", () => {
  assert.equal(startsFromClick(DEFAULT_SETTINGS), false, "a fresh install: popup");
  assert.equal(startsFromClick({ ...DEFAULT_SETTINGS, startOnOpen: true }), false, "one click on (the default): unchanged");
  assert.equal(startsFromClick({ ...DEFAULT_SETTINGS, startOnOpen: true, autoCreate: false }), true);
  assert.equal(startsFromClick({ ...DEFAULT_SETTINGS, startOnOpen: false, autoCreate: false }), false);
  assert.equal(startsFromClick(null), false);
});

test("nothing to hand over goes to the popup, which says why", () => {
  assert.equal(notReady(null), "unreadable");
  assert.equal(notReady({ error: "WEBForms is still loading." }), "unreadable");
  assert.equal(notReady({ source: "deal", forms: [] }), "none");
  assert.equal(notReady({ source: "other", forms: [] }), "none");
  assert.equal(notReady({ source: "open", forms: [], loading: true }), "loading");
  assert.equal(notReady({ source: "open", forms: [{ id: "F1" }], unsaved: true }), "unsaved");
  // Fail closed: a form whose saved state can't be checked is never handed over.
  assert.equal(notReady({ source: "open", forms: [{ id: "F1" }], unsaved: false, cantCheck: true }), "unsaved");
  assert.equal(notReady(dealPicks), null);
});

test("the picks are looked at again before the download: changed or unsaved stops it", () => {
  assert.equal(samePicks(dealPicks, { ...dealPicks, forms: [...dealPicks.forms].reverse() }), true, "order doesn't matter");
  assert.equal(samePicks(dealPicks, { ...dealPicks, forms: dealPicks.forms.slice(0, 1) }), false);
  assert.equal(samePicks(dealPicks, { ...dealPicks, unsaved: true }), false);
  assert.equal(samePicks(dealPicks, null), false);
});

test("the details asked of WEBForms are the popup's", () => {
  assert.deepEqual(detailsRequest(dealPicks), { type: "webforms:details", transactionId: "T-1", formIds: ["F1", "F2"],
    preloaded: null, user: dealPicks.user, transaction: dealPicks.transaction });
  // Basket forms from two deals: no one deal to ask about.
  const mixed = { source: "basket", transactionId: "", forms: [{ id: "A", transactionId: "T-1" }, { id: "B", transactionId: "T-2" }] };
  assert.equal(detailsRequest(mixed).transactionId, "");
  assert.equal(detailsRequest({ ...mixed, forms: [{ id: "A", transactionId: "T-3" }] }).transactionId, "T-3");
});

test("the hand-off: forms by type, the deal's address, the Settings' title", () => {
  const h = webformsHandoff({ sel: dealPicks, d: details, settings: DEFAULT_SETTINGS });
  assert.deepEqual(h.forms.map((f) => [f.id, f.name, f.typeName]), [["F1", "Offer", "Residential Purchase Contract"], ["F2", "Schedule A", "Schedule A"]]);
  assert.equal(h.title, "Sample purchase – 120 Example Street NW, Calgary");
  assert.equal(h.address, "120 Example Street NW Calgary");
  assert.equal(h.userEmail, "jordan@example.com");
  assert.deepEqual(h.buyerNames, ["Riley Sample"]);
  assert.equal(h.titleValues.street, "120 Example Street NW");
  assert.equal(webformsHandoff({ sel: dealPicks, d: details, settings: { ...DEFAULT_SETTINGS, titleMode: "blank" } }).title, "");

  const meta = handoffMeta(h, { source: "deal", title: h.title, formDetails: 1.2 });
  assert.equal(meta.title, h.title);
  assert.equal(meta.source, "deal");
  assert.deepEqual(meta.timings, { formDetails: 1.2 });
  assert.equal(meta.webformsUserName, "Jordan Sample");
  // A blank title is the first form's type name, as the popup did.
  assert.equal(handoffMeta(h, { source: "deal", title: "  ", formDetails: 0 }).title, "Residential Purchase Contract");
});

test("an open form: its saved address on the page beats WEBForms' answer", () => {
  const sel = { source: "open", transactionId: "", unsaved: false, address: { txtp_unitNumber: "", txtp_streetnum: "120", txtp_street: "Example Street NW", txtp_city: "" },
    forms: [{ id: "F9", name: "120", transactionId: "" }] };
  const d = { userName: "Jordan Sample", transaction: null, firstFormValues: { txtp_streetnum: "1", txtp_street: "Old Road" },
    forms: [{ id: "F9", typeName: "Exclusive Buyer Representation Agreement" }] };
  const h = webformsHandoff({ sel, d, settings: DEFAULT_SETTINGS });
  assert.match(h.title, /120 Example Street NW$/);
  assert.equal(h.address, "120 Example Street NW");
  assert.equal(d.firstFormValues.txtp_street, "Old Road", "WEBForms' answer isn't changed in place");
});

test("start from the click: sidePanel.open runs inside tabs.create's callback, nothing awaited before it", () => {
  // Chrome refuses sidePanel.open after any await, or a second API call, or create's
  // promise; it allows it in create's callback (background.js, tried 2026-11-09).
  const bg = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const fn = bg.slice(bg.indexOf("function startFromClick(wf) {"), bg.indexOf("\n}\n", bg.indexOf("function startFromClick(wf) {")));
  assert.ok(fn.length > 0);
  assert.ok(!/\bawait\b|\basync\b|\.then\(\(rs\)/.test(fn.slice(0, fn.indexOf("sidePanel.open"))), "nothing awaited before open");
  assert.match(fn, /chrome\.tabs\.create\(\{ url: `\$\{RS\}home\/draft`, active: false \}, \(rs\) => \{/);
  assert.ok(fn.indexOf("sidePanel.setOptions") < fn.indexOf("sidePanel.open"), "the panel is enabled on the tab before it opens");
  // The click handler calls it straight away, with no await.
  assert.match(bg, /chrome\.action\.onClicked\.addListener\(\(tab\) => \{[\s\S]*?startFromClick\(tab\);\n\}\);/);
  // The worker's hand-off is never one click: one click keeps its popup and its own path.
  assert.match(bg, /return startJob\(\{ wfTabId: wf\.id, wfForms: h\.forms, auto: false, rsTabId: tabId,/);
  // WEBForms has no popup only in this mode.
  assert.match(bg, /popup: rs \|\| \(fromClick && u\.startsWith\(WF\)\) \? "" : POPUP/);
});
