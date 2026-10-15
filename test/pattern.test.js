import { test } from "node:test";
import assert from "node:assert/strict";
import { fillPattern, titleValues, titleFor, subjectFor, DEFAULT_SETTINGS } from "../src/lib/pattern.js";

const v = {
  address: "1234-120 Example Street NW, Calgary", street: "120 Example Street NW", unit: "1234", city: "Calgary",
  forms: "Addendum - Purchase Contract", deal: "", mls: "", agent: "Alex Example", date: "Oct 13, 2026",
};

test("patterns: words filled, empty ones leave no stray dashes or brackets", () => {
  assert.equal(fillPattern("{address} – {forms}", v), "1234-120 Example Street NW, Calgary – Addendum - Purchase Contract");
  assert.equal(fillPattern("{deal} – {address}", v), "1234-120 Example Street NW, Calgary", "leading empty word and its dash");
  assert.equal(fillPattern("{forms} – {deal} – {city}", v), "Addendum - Purchase Contract – Calgary", "middle empty word");
  assert.equal(fillPattern("{forms} ({mls})", v), "Addendum - Purchase Contract", "empty brackets go too");
  assert.equal(fillPattern("{forms}: {mls}", v), "Addendum - Purchase Contract");
  assert.equal(fillPattern("{FORMS} for {Street}", v), "Addendum - Purchase Contract for 120 Example Street NW", "any case");
  assert.equal(fillPattern("{nope} – {city}", v), "{nope} – Calgary", "a typo stays visible");
  assert.equal(fillPattern("{deal}{mls}", v), "", "nothing at all");
  assert.equal(fillPattern("{forms} ".repeat(10), v).length, 120, "capped like every title");
});

test("pattern values come from what WEBForms already gave the panel", () => {
  const now = new Date(2026, 9, 13);
  const standalone = titleValues({ forms: [{ name: "Addendum.pdf" }],
    firstFormValues: { txtp_unitNumber: "#1234", txtp_streetnum: "120", txtp_street: "Example Street NW", txtp_city: "" }, now });
  assert.equal(standalone.address, "1234-120 Example Street NW");
  assert.equal(standalone.unit, "1234");
  assert.equal(standalone.forms, "Addendum");
  assert.equal(standalone.mls, "");
  assert.match(standalone.date, /Oct 13, 2026/);
  const deal = titleValues({ transaction: { Name: "Offer - Jordan Sample", StreetNumber: "120", StreetName: "Example Street NW",
    City: "Calgary", MLSNumber: "A0000000" }, forms: [{ name: "A" }, { name: "B" }], firstFormValues: { txtp_unitNumber: "5" }, now });
  assert.equal(deal.address, "5-120 Example Street NW, Calgary", "the deal's address, with the form's unit");
  assert.equal(deal.deal, "Offer - Jordan Sample");
  assert.equal(deal.mls, "A0000000");
  assert.equal(deal.forms, "A + B");
});

test("settings: defaults change nothing; blank, pattern, and the subject's three modes", () => {
  assert.equal(titleFor({}, v, "Suggested – x"), "Suggested – x");
  assert.equal(titleFor({ titleMode: "blank" }, v, "Suggested"), "");
  assert.equal(titleFor({ titleMode: "pattern", titlePattern: "{city}: {forms}" }, v, "S"), "Calgary: Addendum - Purchase Contract");
  assert.equal(titleFor({ titleMode: "pattern", titlePattern: "{mls}" }, v, "S"), "S", "a pattern that comes out empty falls back");
  assert.equal(subjectFor({}, v, "My title"), "My title");
  assert.equal(subjectFor({ subjectMode: "real" }, v, "My title"), null);
  assert.equal(subjectFor({ subjectMode: "pattern", subjectPattern: "Please sign: {title}" }, v, "My title"), "Please sign: My title");
  assert.equal(DEFAULT_SETTINGS.titleMode, "suggested");
  assert.equal(DEFAULT_SETTINGS.subjectMode, "title");
});
