// Phase 1 pure modules. Invented data only.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 as zcrc } from "node:zlib";

import { unzip, crc32 } from "../src/lib/unzip.js";
import { isPdf, hasAcroForm, countPages, toBase64, fromBase64 } from "../src/lib/pdf.js";
import { suggestTitle, matchAddress, addressLine } from "../src/lib/title.js";
import { WebForms, isAllowed, readBearer, zipEntryName, pairEntries, zipBatches, WebFormsSignedOut, partiesFromFormValues, libraryNamesFrom, agentSideFromFormValues, agentSideFromContacts, combineSides, partiesFromContacts, buyerNamesFromContacts, mergeParties, peopleFromContacts } from "../src/lib/webforms-api.js";
import { formKey } from "../src/lib/match.js";
import { buildDraftBody, signeesFromDeal, countsFromDeal, signersWithoutEmail, signerCounts, sideFromFormNames, templateSlots, isEmail, agentRoleFor, agentPerson, agentPeople, chooseAgents, unfilledRoles, fitSubject, SUBJECT_MAX, cleanSubject, subjectTooLong } from "../src/lib/draft.js";
import { stripTemplate, dropUnusedSlots } from "../src/lib/layout.js";
import { summarizeDeal } from "../src/lib/deals.js";
import { actingNotes, setupReport, senderFor, meFromYenta, meFromDeals, DELEGATION_VERIFIED, samePerson, isOwnCorporation } from "../src/lib/actor.js";
import { sampleTemplate } from "./fixtures.js";

const enc = (s) => new TextEncoder().encode(s);

// A zip writer just for tests. `descriptor` mimics zips that leave local sizes at zero.
function makeZip(entries, { descriptor = false } = {}) {
  const parts = [];
  const central = [];
  let off = 0;
  for (const { name, data, store } of entries) {
    const nameB = enc(name);
    const comp = store ? data : deflateRawSync(data);
    const method = store ? 0 : 8;
    const crc = zcrc(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(descriptor ? 8 : 0, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(descriptor ? 0 : crc, 14);
    local.writeUInt32LE(descriptor ? 0 : comp.length, 18); local.writeUInt32LE(descriptor ? 0 : data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, comp);
    if (descriptor) { const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(comp.length, 8); dd.writeUInt32LE(data.length, 12); parts.push(dd); }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(descriptor ? 8 : 0, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameB.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nameB);
    off += 30 + nameB.length + comp.length + (descriptor ? 16 : 0);
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, e]));
}

const PDF_A = enc("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Pages >> endobj\n%%EOF");
const PDF_FILLABLE = enc("%PDF-1.4\n<< /Root << /AcroForm 5 0 R >> >>\n%%EOF");

test("crc32 matches zlib", () => {
  assert.equal(crc32(PDF_A), zcrc(PDF_A));
});

test("unzip: deflated and stored entries come out byte-identical, in order", async () => {
  const zip = makeZip([{ name: "Sample Contract.pdf", data: PDF_A }, { name: "Folder/", data: new Uint8Array(), store: true }, { name: "Amendment.pdf", data: PDF_A, store: true }]);
  const out = await unzip(zip);
  assert.deepEqual(out.map((e) => e.name), ["Sample Contract.pdf", "Amendment.pdf"]);
  for (const e of out) assert.deepEqual(e.data, PDF_A);
});

test("unzip: zero sizes in the local header (data descriptor) still work", async () => {
  const out = await unzip(makeZip([{ name: "A.pdf", data: PDF_A }], { descriptor: true }));
  assert.deepEqual(out[0].data, PDF_A);
});

test("unzip: corruption and non-zips fail loudly", async () => {
  const zip = makeZip([{ name: "A.pdf", data: PDF_A, store: true }]);
  zip[40] ^= 0xff; // flip a byte inside the stored PDF
  await assert.rejects(unzip(zip), /didn't unpack cleanly/);
  await assert.rejects(unzip(enc("%PDF-1.4 not a zip at all, just text padding")), /isn't a zip/);
  // An entry whose local header lies past the end: a plain message, not a RangeError.
  const far = makeZip([{ name: "A.pdf", data: PDF_A, store: true }]);
  const dv = new DataView(far.buffer, far.byteOffset, far.byteLength);
  const cd = dv.getUint32(far.length - 22 + 16, true);
  dv.setUint32(cd + 42, far.length + 1000, true);
  await assert.rejects(unzip(far), /entries are damaged/);
});

test("pdf checks", () => {
  assert.ok(isPdf(PDF_A));
  assert.ok(!isPdf(enc("<html>")));
  assert.ok(!hasAcroForm(PDF_A));
  assert.ok(hasAcroForm(PDF_FILLABLE));
  assert.equal(countPages(PDF_A), 2);
  assert.equal(countPages(enc("%PDF-1.5 compressed")), null);
  assert.deepEqual(fromBase64(toBase64(PDF_A)), PDF_A);
});

test("title: deal name, address appended only when complete and not already there", () => {
  const t = { Name: "Offer - Jordan Sample", StreetNumber: "120", StreetName: "Example Street NW", City: "Calgary" };
  assert.equal(suggestTitle({ transaction: t, forms: [] }), "Offer - Jordan Sample – 120 Example Street NW, Calgary");
  assert.equal(suggestTitle({ transaction: { ...t, Name: "Offer 120 Example St NW" }, forms: [] }), "Offer 120 Example St NW");
  assert.equal(suggestTitle({ transaction: { ...t, City: "" }, forms: [] }), "Offer - Jordan Sample – 120 Example Street NW", "no city: number and street still go in");
  assert.equal(suggestTitle({ transaction: { ...t, StreetNumber: "" }, forms: [] }), "Offer - Jordan Sample", "no civic number: no address");
  const oneLine = { Name: "Offer - Jordan Sample", StreetNumber: "", StreetName: "", City: "", Address: "120 Example Street NW, Calgary" };
  assert.equal(suggestTitle({ transaction: oneLine, forms: [] }), "Offer - Jordan Sample – 120 Example Street NW, Calgary", "only the one-line Address filled in");
  assert.equal(suggestTitle({ transaction: { ...oneLine, Address: "Lot 4, Example Estates" }, forms: [] }), "Offer - Jordan Sample", "one-line Address without a civic number: no address");
  // The whole address typed into the street field, civic number blank, city with province and postal code.
  const typed = { Name: "Offer - Jordan Sample", StreetNumber: "", StreetName: "12, 120-5 Example St SE", City: "Calgary AB T2G 0A1", Address: " 12, 120-5 Example St SE" };
  assert.equal(suggestTitle({ transaction: typed, forms: [] }), "Offer - Jordan Sample – 12, 120-5 Example St SE, Calgary");
  assert.equal(addressLine({ streetNumber: "", streetName: "12, 120-5 Example St SE", city: "Calgary, Alberta" }), "12, 120-5 Example St SE, Calgary");
  assert.equal(addressLine({ streetNumber: "", streetName: "Example Estates", city: "Calgary" }), null, "no number anywhere");
  assert.equal(addressLine({ streetNumber: "", streetName: "12, 120 5 Street SE, Calgary AB T2G0A1", city: "" }), "12, 120 5 Street SE, Calgary", "province and postal code trimmed from a whole address");
  assert.equal(addressLine({ streetNumber: "", streetName: "12, 120 5 Street SE, Calgary AB T2G0A1", city: "Calgary" }), "12, 120 5 Street SE, Calgary", "city not added twice");
  assert.equal(addressLine({ unit: "#12", streetNumber: "", streetName: "12, 120 5 Street SE, Calgary AB T2G0A1", city: "" }), "12-120 5 Street SE, Calgary", "unit typed in both places: once, in front");
  assert.equal(addressLine({ unit: "12", streetNumber: "", streetName: "120 5 Street SE", city: "Calgary" }), "12-120 5 Street SE, Calgary", "unit only in its own field");
});

test("title: standalone forms use form names and the typed-in address", () => {
  const v = { txtp_streetnum: "12", txtp_street: "Sample Avenue SW", txtp_city: "Calgary" };
  assert.equal(suggestTitle({ transaction: null, forms: [{ name: "Addendum.pdf" }], firstFormValues: v }), "Addendum – 12 Sample Avenue SW, Calgary");
  assert.equal(suggestTitle({ transaction: null, forms: [{ name: "A" }, { name: "B" }], firstFormValues: null }), "A + B");
  const both = "Agreement to Represent Both Seller and Buyer (Designated Agency)";
  assert.equal(suggestTitle({ transaction: null, forms: [{ name: both }, { name: "Addendum" }, { name: "Addendum" }], firstFormValues: v }),
    "Agreement to Represent Both Seller and Buyer + Addendum ×2 – 12 Sample Avenue SW, Calgary", "asides dropped, repeats counted");
  assert.equal(suggestTitle({ transaction: null, forms: [{ name: both }, { name: "Addendum - Purchase Contract" }, { name: "Property Disclosure Statement" }] }),
    "Agreement to Represent Both Seller and Buyer + 2 more", "too long: first and a count");
  assert.equal(addressLine({ streetNumber: "12", streetName: "", city: "Calgary" }), null);
  assert.equal(addressLine({ unit: "1234", streetNumber: "120", streetName: "Example Street", city: "" }), "1234-120 Example Street", "unit first, Canada Post style");
  assert.equal(addressLine({ unit: "Unit 5", streetNumber: "120", streetName: "Example Street", city: "Calgary" }), "5-120 Example Street, Calgary");
  assert.equal(suggestTitle({ transaction: null, forms: [{ name: "Addendum" }], firstFormValues: { ...v, txtp_unitNumber: "1234" } }), "Addendum – 1234-12 Sample Avenue SW, Calgary");
  assert.equal(matchAddress({ transaction: null, firstFormValues: v }), "12 Sample Avenue SW Calgary");
  assert.equal(suggestTitle({ transaction: null, forms: [{ name: "x".repeat(200) }] }).length, 120);
});

test("WEBForms client: only the allowlisted requests, nothing that saves or sends", () => {
  assert.ok(isAllowed("GET", "/api/transactions/Basic/abc"));
  assert.ok(isAllowed("GET", "/api/formeditor/formfields/abc"));
  assert.ok(isAllowed("POST", "/api/Transfer/CreateDownloadRequest"));
  assert.ok(isAllowed("GET", "/api/Transfer/downloadmany"));
  assert.ok(isAllowed("GET", "/api/forms/single/abc"));
  assert.ok(isAllowed("GET", "/api/forms/index"));
  assert.ok(!isAllowed("POST", "/api/forms/single/abc"), "read-only: GET only");
  for (const [m, p] of [["PUT", "/api/formeditor/saveForm/abc"], ["POST", "/api/formeditor/saveMarkups/abc"],
    ["POST", "/api/AppsStore/SendItems"], ["GET", "/api/Transfer/printpdf"], ["GET", "/api/Transfer/downloadsingle"],
    ["DELETE", "/api/forms/abc"], ["POST", "/api/transactions/Basic/abc"]]) {
    assert.ok(!isAllowed(m, p), `${m} ${p} must be refused`);
  }
  assert.equal(readBearer('"tok"'), "tok");
  assert.equal(readBearer("not json"), null);
});

test("form types: library code → type name, and the template choice is keyed on the type", () => {
  const tree = [{ Name: "Individual Forms", Misc: null, Folders: [{ Name: "Alberta Real Estate Association", Misc: "", Folders: [
    { Name: "Agreement to Represent Both Seller and Buyer (Designated Agency)", Misc: "AREA0287", Folders: [] },
    { Name: "Addendum - Purchase Contract", Misc: "AREA0123", Folders: [] },
  ] }] }, { Name: "Transaction Forms", Folders: [{ Name: "Renamed copy", Misc: "AREA0287", Folders: [] }] }];
  const names = libraryNamesFrom(tree);
  assert.equal(names.AREA0287, "Agreement to Represent Both Seller and Buyer (Designated Agency)", "first one wins");
  assert.equal(names.AREA0123, "Addendum - Purchase Contract");
  assert.equal(Object.keys(names).length, 2, "folders without a code are skipped");
  // Two forms of one type, named after their civic numbers, share a remembered template.
  assert.equal(formKey({ library: "AREA0287", name: "120" }), formKey({ library: "AREA0287", name: "12" }));
  assert.equal(formKey({ name: "Addendum.pdf" }), "name:addendum");
});

test("WEBForms client: zip download is the two requests WEBForms' button sends", async () => {
  const seen = [];
  const wf = new WebForms({
    getToken: () => "tok", origin: "https://wf.test",
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (url.includes("CreateDownloadRequest")) return { ok: true, status: 200, text: async () => '"0f8fad5b-d9cb-469f-a165-70867728950e"' };
      return { ok: true, status: 200, arrayBuffer: async () => PDF_A.buffer };
    },
  });
  const bytes = await wf.downloadZip([{ id: "f1", name: "Sample Contract" }]);
  assert.deepEqual(bytes, PDF_A);
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(JSON.parse(seen[0].init.body), [{ Id: "f1", Name: "Sample Contract" }]);
  assert.match(seen[0].url, /CreateDownloadRequest\?type=1$/);
  assert.match(seen[1].url, /downloadmany\?token=0f8fad5b/);
  assert.equal(seen[1].init.headers.Authorization, "Bearer tok");
  await assert.rejects(new WebForms({ getToken: () => null, fetchImpl: async () => ({}) }).userName(), WebFormsSignedOut);
});

test("WEBForms client: an unexpected download token is refused, not guessed", async () => {
  const wf = new WebForms({ getToken: () => "t", fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"odd":1}' }) });
  await assert.rejects(wf.downloadZip([{ id: "f", name: "A" }]), /changed shape/);
});

test("zip entries pair with forms by WEBForms' file naming; duplicates refused", () => {
  assert.equal(zipEntryName("Amendment 1/2: Price"), "Amendment 1_2_ Price.pdf");
  const entries = [{ name: "B.pdf", data: 2 }, { name: "A_x.pdf", data: 1 }];
  assert.deepEqual(pairEntries([{ name: "A/x" }, { name: "B" }], entries).map((p) => p.data), [1, 2]);
  assert.throws(() => pairEntries([{ name: "A" }, { name: "A" }], [{ name: "A.pdf" }]), /Two of the picked forms/);
  assert.throws(() => pairEntries([{ name: "C" }], entries), /wasn't in/);
});

test("two copies of one form go in separate downloads, so each file is its own form's", () => {
  const a1 = { id: "1", name: "Sample Notice" }, b = { id: "2", name: "Sample/Waiver" };
  const a2 = { id: "3", name: "Sample Notice" }, a3 = { id: "4", name: "Sample Notice" };
  assert.deepEqual(zipBatches([a1, b]), [[a1, b]]);
  assert.deepEqual(zipBatches([a1, b, a2, a3]), [[a1, b], [a2], [a3]]);
  // "A/x" and "A_x" are the same file name in the zip.
  const s1 = { id: "5", name: "A/x" }, s2 = { id: "6", name: "A_x" };
  assert.deepEqual(zipBatches([s1, s2]), [[s1], [s2]]);
  for (const batch of zipBatches([a1, b, a2, a3])) {
    const entries = batch.map((f) => ({ name: zipEntryName(f.name), data: f.id }));
    assert.deepEqual(pairEntries(batch, entries).map((p) => p.data), batch.map((f) => f.id));
  }
});

const sampleDealRaw = {
  id: "deal-1", mlsNum: "\tA0000000", address: { oneLine: "120 Example Street NW,  Calgary" },
  transactionOwner: { id: "agent-1", name: "Alex Example" },
  participants: [
    { participantRole: "BUYER", firstName: "Jordan", lastName: "Sample", emailAddress: "jordan@example.com" },
    { participantRole: "BUYER", firstName: "Sam", lastName: "Sample", emailAddress: "sam@example.com" },
    { participantRole: "SELLER", firstName: "Casey", lastName: "Placeholder", emailAddress: "casey@example.com" },
    { participantRole: "TRANSACTION_COORDINATOR", firstName: "Taylor", lastName: "Example", emailAddress: "tc@example.com" },
  ],
};

test("deal summary trims hand-typed fields and keeps the roles", () => {
  const d = summarizeDeal(sampleDealRaw);
  assert.equal(d.address, "120 Example Street NW, Calgary");
  assert.equal(d.mlsNum, "A0000000");
  assert.deepEqual(countsFromDeal(d), { BUYER: 2, SELLER: 1 });
});

test("draft body: template blocks, deal, signers within the counts, sender", () => {
  const deal = summarizeDeal(sampleDealRaw);
  const counts = { BUYER: 1, SELLER: 1 };
  const layout = dropUnusedSlots(stripTemplate(sampleTemplate()), counts);
  const draft = { id: "new", name: "Sample.pdf", type: "USER_PDF", draft: true, pagesCount: null, defaults: null, fieldDefinitions: [], signeeConfigs: [], documentFieldValidations: [] };
  const me = meFromYenta({ id: "agent-1", firstName: "Alex", lastName: "Example", emailAddress: "alex@example.com", type: "AGENT" });
  const body = buildDraftBody({ draft, layout, name: "Offer – 120 Example Street NW", pageCount: 3, transactionId: deal.id,
    counts, signees: signeesFromDeal(deal, counts), sender: senderFor(me, deal) });
  assert.equal(body.id, "new");
  assert.equal(body.pagesCount, 3);
  assert.equal(body.defaults.transactionId, "deal-1");
  assert.deepEqual(body.defaults.signees.map((s) => [s.signeeType, s.signeeIndex, s.name]), [["BUYER", 0, "Jordan Sample"], ["SELLER", 0, "Casey Placeholder"]]);
  assert.equal(body.defaults.sender.agentYentaId, null);
  assert.equal(body.fieldDefinitions.length, 3);
  assert.ok(!JSON.stringify(body).includes("Hi Jordan"), "template's email body must not ride along");
  assert.equal(body.defaults.emailSubject, null, "no title given: no subject, and never the template's");
  const titled = buildDraftBody({ draft, layout, name: "x", pageCount: 3, transactionId: null, counts, signees: [],
    sender: senderFor(me, null), emailSubject: "Offer – 120 Example Street NW" });
  assert.equal(titled.defaults.emailSubject, "Offer – 120 Example Street NW", "the subject is the panel's title");
  // Real refuses the save over 70 characters (400, 2026-10-26).
  const long = "1234-120 Example Street NW, Winnipeg - MLS® Listing Withdrawal Contract";
  const fitted = buildDraftBody({ draft, layout, name: "x", pageCount: 3, transactionId: null, counts, signees: [],
    sender: senderFor(me, null), emailSubject: long }).defaults.emailSubject;
  assert.ok(fitted.length <= SUBJECT_MAX, `fits Real's limit: ${fitted.length}`);
  assert.equal(fitted, "1234-120 Example Street NW, Winnipeg - MLS® Listing Withdrawal…", "cut at a word");
  assert.equal(fitSubject("x".repeat(90)).length, SUBJECT_MAX, "no space to cut at: hard cut");
  assert.equal(fitSubject("  "), null);
  assert.deepEqual(unfilledRoles(body), [], "every role named: stays a single draft");
  assert.deepEqual(unfilledRoles(titled).sort(), ["BUYER", "SELLER"], "nobody named: goes in a packet of one");
});

test("unfilled roles: fewer named than slots, agents included", () => {
  const body = (configs, signees) => ({ signeeConfigs: configs, defaults: { signees } });
  const cfg = [{ signeeType: "BUYER", maxNum: 2 }, { signeeType: "SELLER", maxNum: 1 }, { signeeType: "SELLERS_AGENT", maxNum: 1 }];
  const s = (t, i) => ({ signeeType: t, signeeIndex: i, name: "Jordan Sample", email: "jordan@example.com" });
  assert.deepEqual(unfilledRoles(body(cfg, [s("BUYER", 0), s("SELLER", 0), s("SELLERS_AGENT", 0)])), ["BUYER"], "one of two buyers");
  assert.deepEqual(unfilledRoles(body(cfg, [s("SELLERS_AGENT", 0)])), ["BUYER", "SELLER"], "agent only, no clients (the standalone agreement, 2026-10-14)");
  assert.deepEqual(unfilledRoles(body([{ signeeType: "BUYER", maxNum: 0 }], [])), [], "a zero-slot role isn't waiting for anyone");
  assert.deepEqual(unfilledRoles({}), []);
});

test("signer counts follow the side represented, then the form names", () => {
  const people = [
    { role: "BUYER", firstName: "Jordan", lastName: "Sample", email: "jordan@example.com" },
    { role: "BUYER", firstName: "Riley", lastName: "Sample", email: "riley@example.com" },
    { role: "SELLER", firstName: "Casey", lastName: "Placeholder", email: "" },
  ];
  const raw = (represents) => ({ id: "d", address: { oneLine: "120 Example Street NW" }, transactionOwner: { represents }, participants: people.map((p) => ({ participantRole: p.role, firstName: p.firstName, lastName: p.lastName, emailAddress: p.email })) });
  const deal = (r, o) => summarizeDeal(raw(r), o);
  assert.equal(deal("Buy Side Representation").side, "BUYER");
  assert.equal(deal("Listing Side Representation").side, "SELLER");
  assert.equal(deal("Dual Representation").side, "DUAL");
  assert.equal(deal(undefined).side, null);
  assert.equal(deal(undefined, { listing: true }).side, "SELLER");

  const offer = ["Residential Purchase Contract"];
  assert.deepEqual(signerCounts({ deal: deal("Buy Side Representation"), formNames: offer }).counts, { BUYER: 2, SELLER: 0 });
  assert.deepEqual(signerCounts({ deal: deal("Listing Side Representation"), formNames: offer }).counts, { BUYER: 0, SELLER: 2 });
  assert.deepEqual(signerCounts({ deal: deal("Dual Representation"), formNames: offer }).counts, { BUYER: 2, SELLER: 2 });
  assert.deepEqual(signerCounts({ deal: deal("Dual Representation"), formNames: ["Exclusive Seller Representation Agreement"] }).counts, { BUYER: 0, SELLER: 2 });
  assert.deepEqual(signerCounts({ deal: null, formNames: ["Buyer Representation Agreement"] }).counts, { BUYER: 2, SELLER: 0 });
  assert.deepEqual(signerCounts({ deal: null, formNames: ["Listing Agreement", "Property Disclosure Statement"] }).counts, { BUYER: 0, SELLER: 2 });
  assert.deepEqual(signerCounts({ deal: null, formNames: ["Seller's Acceptance of Buyer's Offer"] }).counts, { BUYER: 2, SELLER: 2 });
  assert.deepEqual(signerCounts({ deal: null, formNames: ["Buyer Representation Agreement", "Listing Agreement"] }).counts, { BUYER: 2, SELLER: 2 });
  assert.match(signerCounts({ deal: null, formNames: ["Buyer Representation Agreement", "Buyer's Acknowledgement"] }).why, /these are buyer's forms/);
  // a deal with three buyers keeps three
  const three = summarizeDeal({ ...raw("Buy Side Representation"), participants: [1, 2, 3].map((i) => ({ participantRole: "BUYER", firstName: "B" + i, lastName: "Sample", emailAddress: "b" + i + "@example.com" })) });
  assert.deepEqual(signerCounts({ deal: three, formNames: offer }).counts, { BUYER: 3, SELLER: 0 });
  assert.equal(sideFromFormNames(offer), null);
  // a neutral form beside a seller's one doesn't cancel it (2026-10-15)
  const pair = ["Consumer Relationships Guide (Print Friendly)", "Exclusive Seller Representation Agreement (designated agency)"];
  assert.equal(sideFromFormNames(pair), "SELLER");
  assert.deepEqual(signerCounts({ deal: null, formNames: pair }).counts, { BUYER: 0, SELLER: 2 });
  // the guide alone gives no side: both, 2 each
  assert.deepEqual(signerCounts({ deal: null, formNames: ["Consumer Relationships Guide"] }).counts, { BUYER: 2, SELLER: 2 });
  // and the sellers typed on the pair's forms set the number
  assert.deepEqual(signerCounts({ deal: null, formNames: pair, webforms: [{ BUYER: 0, SELLER: 1 }] }).counts, { BUYER: 0, SELLER: 1 });
});

test("signer counts: the picked templates' slots raise the count and, without a deal side, pick the side", () => {
  assert.deepEqual(templateSlots([
    { signeeType: "SELLER", signeeIndex: 0 }, { signeeType: "SELLER", signeeIndex: 2 }, { signeeType: "SENDER", signeeIndex: 0 },
  ]), { BUYER: 0, SELLER: 3, AGENT: 0 });
  const sellers3 = { BUYER: 0, SELLER: 3 }, buyers1 = { BUYER: 1, SELLER: 0 }, both = { BUYER: 2, SELLER: 2 };
  const offer = ["Residential Purchase Contract"];
  // no deal: template decides the side, and its 3 slots beat the minimum of 2
  const r = signerCounts({ deal: null, formNames: offer, templates: [sellers3] });
  assert.deepEqual(r.counts, { BUYER: 0, SELLER: 3 });
  assert.match(r.why, /only has seller blocks.*no sellers named in WEBForms, and your template has blocks for 3/);
  // template beats a form name pointing the other way
  assert.deepEqual(signerCounts({ deal: null, formNames: ["Buyer Representation Agreement"], templates: [sellers3] }).counts, { BUYER: 0, SELLER: 3 });
  // a two-sided template gives no side clue; never fewer than 2
  assert.deepEqual(signerCounts({ deal: null, formNames: offer, templates: [both] }).counts, { BUYER: 2, SELLER: 2 });
  assert.deepEqual(signerCounts({ deal: null, formNames: offer, templates: [buyers1] }).counts, { BUYER: 2, SELLER: 0 });
  // the deal's side wins over a template: a buy-side deal never asks the sellers
  const buySide = { side: "BUYER", participants: [{ role: "BUYER" }] };
  assert.deepEqual(signerCounts({ deal: buySide, formNames: offer, templates: [sellers3] }).counts, { BUYER: 2, SELLER: 0 });
  // dual: template narrows it
  const dual = { side: "DUAL", participants: [{ role: "BUYER" }, { role: "SELLER" }] };
  assert.deepEqual(signerCounts({ deal: dual, formNames: offer, templates: [sellers3] }).counts, { BUYER: 0, SELLER: 3 });
});

test("the agent's side from the WEBForms agent emails decides who signs when the deal can't", () => {
  const offerValues = { txtl_brkagentemail: "lister@example.com", txts_brkagentemail: " Alex@Example.com " };
  assert.equal(agentSideFromFormValues(offerValues, "alex@example.com"), "BUYER");
  assert.equal(agentSideFromFormValues(offerValues, "lister@example.com"), "SELLER");
  assert.equal(agentSideFromFormValues({ txtl_brkagentemail: "a@example.com", txts_brkagentemail: "a@example.com" }, "a@example.com"), "DUAL");
  assert.equal(agentSideFromFormValues(offerValues, "tc@example.com"), null, "a TC's own login: no side");
  assert.equal(agentSideFromFormValues(offerValues, null), null);
  assert.equal(agentSideFromFormValues({}, "alex@example.com"), null);
  // the transaction's Contacts, WEBForms' wording: "Selling Agent" is the listing side
  const contact = (type, email) => ({ TransactionContactTypeName: type, ContactData: { General: { FirstName: "X", LastName: "Example", Email: email } } });
  const contacts = [contact("Buying Agent", "Alex@example.com"), contact("Selling Agent", "lister@example.com"), contact("Buyer", "")];
  assert.equal(agentSideFromContacts(contacts, "alex@example.com"), "BUYER");
  assert.equal(agentSideFromContacts(contacts, "lister@example.com"), "SELLER");
  assert.equal(agentSideFromContacts([contact("Buying Agent", "a@example.com"), contact("Selling Agent", "a@example.com")], "a@example.com"), "DUAL");
  assert.equal(agentSideFromContacts(contacts, "tc@example.com"), null);
  assert.equal(agentSideFromContacts(null, "alex@example.com"), null);
  assert.equal(isAllowed("GET", "/api/transactioncontacts/index/abc"), true);
  assert.equal(isAllowed("POST", "/api/transactioncontacts/index/abc"), false, "reading Contacts only, never changing them");
  // buyers and sellers from Contacts, the same in every province; per side, forms fill in
  const people = [...contacts, contact("Seller", ""), contact("Seller", ""), { TransactionContactTypeName: "Buyer", ContactData: { General: { FirstName: "Jordan", LastName: "Sample" } } }];
  assert.deepEqual(partiesFromContacts(people), { BUYER: 2, SELLER: 2 });
  assert.deepEqual(buyerNamesFromContacts(people), ["X Example", "Jordan Sample"]);
  assert.deepEqual(mergeParties({ BUYER: 1, SELLER: 0 }, [{ BUYER: 2, SELLER: 3 }]), { BUYER: 1, SELLER: 3 }, "Contacts win where they list anyone");
  assert.deepEqual(mergeParties(partiesFromContacts(null), [{ BUYER: 1, SELLER: 2 }, { BUYER: 2, SELLER: 0 }]), { BUYER: 2, SELLER: 2 });
  // with no reZEN deal, the Buyer and Seller contacts become the signers; no email, no signer
  const asPeople = peopleFromContacts([
    { TransactionContactTypeName: "Buyer", ContactData: { General: { FirstName: " Jordan ", LastName: "Sample", Email: "jordan@example.com" } } },
    { TransactionContactTypeName: "Seller", ContactData: { General: { FirstName: "Casey", LastName: "Placeholder", Email: "" } } },
    contact("Buying Agent", "alex@example.com"),
  ]);
  assert.deepEqual(asPeople, [
    { role: "BUYER", firstName: "Jordan", lastName: "Sample", email: "jordan@example.com" },
    { role: "SELLER", firstName: "Casey", lastName: "Placeholder", email: "" },
  ]);
  assert.deepEqual(signeesFromDeal({ participants: asPeople }, { BUYER: 1, SELLER: 1 }).map((s) => [s.signeeType, s.name, s.email]),
    [["BUYER", "Jordan Sample", "jordan@example.com"]]);
  assert.deepEqual(signersWithoutEmail({ participants: asPeople }, { BUYER: 1, SELLER: 1 }), [{ role: "SELLER", slot: 1, name: "Casey Placeholder" }]);
  // WEBForms' real shape: each field is {InputLabel, Value, …}, not a string — String() of it
  // was "[object Object]", sent to Real as an email (2026-10-14)
  const asInput = (Value, InputLabel) => ({ InputLabel, Value, Type: 7, Visible: false, Disabled: false });
  const live = [
    { TransactionContactTypeName: "Buyer", ContactData: { General: { FirstName: asInput("Jordan", "First Name"), LastName: asInput("Sample", "Last Name"), Email: asInput("jordan@example.com", "Email"), AlternateEmail: asInput("", "Alternate Email") } } },
    { TransactionContactTypeName: "Seller", ContactData: { General: { FirstName: asInput("Casey", "First Name"), LastName: asInput("Placeholder", "Last Name"), Email: asInput("", "Email") } } },
    { TransactionContactTypeName: "Buying Agent", ContactData: { General: { FirstName: asInput("Alex", "First Name"), LastName: asInput("Agent", "Last Name"), Email: asInput("Alex@example.com", "Email") } } },
  ];
  assert.deepEqual(peopleFromContacts(live), asPeople);
  assert.deepEqual(buyerNamesFromContacts(live), ["Jordan Sample"]);
  assert.equal(agentSideFromContacts(live, "alex@example.com"), "BUYER");
  // anything that isn't an email is no email (Real refuses the whole draft over one)
  const placeholder = [{ role: "BUYER", firstName: "Jordan", lastName: "Sample", email: "[Client Email]" }];
  assert.deepEqual(signeesFromDeal({ participants: placeholder }, { BUYER: 1, SELLER: 0 }), []);
  assert.equal(signersWithoutEmail({ participants: placeholder }, { BUYER: 1, SELLER: 0 }).length, 1);
  assert.equal(isEmail("jordan@example.com"), true);
  assert.equal(isEmail(" Jordan.Sample+x@mail.example.ca "), true);
  assert.equal(isEmail("Jordan Sample <jordan@example.com>"), false);
  assert.equal(isEmail("jordan@example"), false);
  assert.equal(combineSides(["BUYER", null, "BUYER"]), "BUYER");
  assert.equal(combineSides(["BUYER", "SELLER"]), null);

  const offer = ["Residential Purchase Contract"];
  const webforms = [{ BUYER: 1, SELLER: 2 }];
  const r = signerCounts({ deal: null, formNames: offer, webforms, agentSide: "BUYER" });
  assert.deepEqual(r.counts, { BUYER: 1, SELLER: 0 });
  assert.match(r.why, /buyer's agent on the WEBForms form/);
  assert.deepEqual(signerCounts({ deal: null, formNames: offer, webforms, agentSide: "SELLER" }).counts, { BUYER: 0, SELLER: 2 });
  assert.deepEqual(signerCounts({ deal: null, formNames: offer, webforms, agentSide: "DUAL" }).counts, { BUYER: 1, SELLER: 2 });
  // the reZEN deal's own side still comes first
  assert.deepEqual(signerCounts({ deal: { side: "SELLER", participants: [] }, formNames: offer, webforms, agentSide: "BUYER" }).counts, { BUYER: 0, SELLER: 2 });
  // and the agent role follows it with no template
  assert.equal(agentRoleFor({ layout: null, counts: { BUYER: 1, SELLER: 2 }, dealSide: "BUYER" }), "BUYERS_AGENT");
});

test("WEBForms name lines → buyer/seller counts; a shared line counts as two, a company as one", () => {
  assert.deepEqual(partiesFromFormValues({ txtbuyer1: "Jordan Sample", txtbuyer2: "", txtseller1: "Casey & Riley Placeholder", txtseller2: "Sam Placeholder" }),
    { BUYER: 1, SELLER: 3 });
  assert.deepEqual(partiesFromFormValues({ txtbuyer1: "Example Holdings Ltd. and Sons", txtbuyersig1: "Jordan Sample", txtbuyersig2: "Riley Sample" }),
    { BUYER: 2, SELLER: 0 });
  assert.deepEqual(partiesFromFormValues({}), { BUYER: 0, SELLER: 0 });
  assert.deepEqual(partiesFromFormValues(null), { BUYER: 0, SELLER: 0 });
  // The names on the form set the number (Dan, 2026-10-14), one named buyer = one slot;
  // a side with nobody named falls back to 2. They never pick the side.
  const offer = ["Residential Purchase Contract"];
  const r = signerCounts({ deal: null, formNames: offer, webforms: [{ BUYER: 1, SELLER: 3 }] });
  assert.deepEqual(r.counts, { BUYER: 1, SELLER: 3 });
  assert.match(r.why, /1 buyer named in WEBForms; 3 sellers named in WEBForms/);
  assert.deepEqual(signerCounts({ deal: { side: "BUYER", participants: [] }, formNames: offer, webforms: [{ BUYER: 1, SELLER: 3 }] }).counts, { BUYER: 1, SELLER: 0 });
  assert.deepEqual(signerCounts({ deal: null, formNames: offer, webforms: [{ BUYER: 0, SELLER: 2 }] }).counts, { BUYER: 2, SELLER: 2 });
  // fewer named than the template has blocks for: the extra blocks are left off
  assert.deepEqual(signerCounts({ deal: null, formNames: offer, templates: [{ BUYER: 2, SELLER: 0 }], webforms: [{ BUYER: 1, SELLER: 2 }] }).counts, { BUYER: 1, SELLER: 0 });
});

test("the agent as a signer: role from the template or the side, person from the deal, never a TC", () => {
  const cfg = (...types) => ({ signeeConfigs: types.map((signeeType) => ({ signeeType, minNum: 0, maxNum: 1 })) });
  assert.equal(agentRoleFor({ layout: cfg("SELLER", "SELLERS_AGENT") }), "SELLERS_AGENT");
  assert.equal(agentRoleFor({ layout: cfg("BUYER") }), null, "template without agent blocks: the agent doesn't sign it");
  assert.equal(agentRoleFor({ layout: null, counts: { BUYER: 2, SELLER: 0 } }), "BUYERS_AGENT");
  assert.equal(agentRoleFor({ layout: null, counts: { BUYER: 2, SELLER: 2 } }), null, "dual without a template or deal: can't tell");
  assert.equal(agentRoleFor({ layout: null, counts: { BUYER: 2, SELLER: 2 }, dealSide: "SELLER" }), "SELLERS_AGENT", "both sides sign, no template: the deal's side");
  assert.equal(agentRoleFor({ layout: null, counts: { BUYER: 2, SELLER: 2 }, dealSide: "DUAL" }), null, "a dual deal doesn't say either");
  assert.equal(agentRoleFor({ layout: cfg("BUYER"), counts: { BUYER: 2 }, dealSide: "BUYER" }), null, "a template without agent blocks still wins");

  const me = meFromYenta({ id: "agent-1", firstName: "Alex", lastName: "Example", emailAddress: "alex@example.com", type: "AGENT" });
  const deal = { ownerId: "agent-2", agentName: "Morgan Example", participants: [
    { role: "BUYERS_AGENT", firstName: "Taylor", lastName: "Example", email: "taylor@example.com" },
    { role: "BUYERS_AGENT", firstName: "Morgan", lastName: "Example", email: "morgan@example.com" },
  ] };
  assert.equal(agentPerson({ deal, role: "BUYERS_AGENT", me }).email, "morgan@example.com", "the deal owner, by name");
  assert.equal(agentPerson({ deal: { ...deal, participants: [...deal.participants, { role: "BUYERS_AGENT", firstName: "Alex", lastName: "Example", email: "ALEX@example.com" }] }, role: "BUYERS_AGENT", me }).email,
    "ALEX@example.com", "the signed-in agent, if on the deal");
  assert.equal(agentPerson({ deal: null, role: "BUYERS_AGENT", me }).email, "alex@example.com", "no deal: me, an agent");
  assert.equal(agentPerson({ deal: null, role: "BUYERS_AGENT", me: { ...me, type: "TRANSACTION_COORDINATOR" } }), null, "a TC is never the agent");
  assert.equal(agentPerson({ deal: { ownerId: "agent-2", participants: [] }, role: "BUYERS_AGENT", me }), null, "someone else's deal with no agent listed");

  const draft = { id: "new", name: "x", defaults: null, fieldDefinitions: [], signeeConfigs: [], documentFieldValidations: [] };
  const body = buildDraftBody({ draft, layout: null, name: "x", pageCount: 1, transactionId: null, counts: { BUYER: 2, SELLER: 0 }, signees: [],
    sender: senderFor(me, null), agents: { signeeType: "BUYERS_AGENT", people: [{ name: "Alex Example", email: "alex@example.com" }] } });
  assert.deepEqual(body.signeeConfigs, [{ signeeType: "BUYER", minNum: 0, maxNum: 2 }, { signeeType: "BUYERS_AGENT", minNum: 0, maxNum: 1 }]);
  assert.deepEqual(body.defaults.signees.map((s) => [s.signeeType, s.signeeIndex, s.email]), [["BUYERS_AGENT", 0, "alex@example.com"]]);

  // a team deal: one signs (the chosen one, else the best match), or all of them
  const team = agentPeople({ deal, role: "BUYERS_AGENT", me });
  assert.deepEqual(team.map((p) => p.email), ["morgan@example.com", "taylor@example.com"], "owner first, then reZEN's order");
  assert.deepEqual(chooseAgents(team, "taylor@example.com").map((p) => p.email), ["taylor@example.com"]);
  assert.deepEqual(chooseAgents(team, "best").map((p) => p.email), ["morgan@example.com"]);
  assert.equal(chooseAgents(team, "all").length, 2);
  // impersonating a teammate in WEBForms: their file, so they lead — even over the signed-in agent
  const onDeal = { ...deal, participants: [...deal.participants, { role: "BUYERS_AGENT", firstName: "Alex", lastName: "Example", email: "alex@example.com" }] };
  assert.equal(agentPeople({ deal: onDeal, role: "BUYERS_AGENT", me })[0].email, "alex@example.com");
  assert.equal(agentPeople({ deal: onDeal, role: "BUYERS_AGENT", me, webformsUserName: "taylor  example" })[0].email, "taylor@example.com");
  const layout = { fieldDefinitions: [], documentFieldValidations: [], pagesCount: 1,
    signeeConfigs: [{ signeeType: "SELLER", minNum: 0, maxNum: 2 }, { signeeType: "BUYERS_AGENT", minNum: 0, maxNum: 1 }] };
  const both = buildDraftBody({ draft, layout, name: "x", pageCount: 1, transactionId: null, counts: { BUYER: 0, SELLER: 2 }, signees: [],
    sender: senderFor(me, null), agents: { signeeType: "BUYERS_AGENT", people: team } });
  assert.deepEqual(both.signeeConfigs.find((c) => c.signeeType === "BUYERS_AGENT"), { signeeType: "BUYERS_AGENT", minNum: 0, maxNum: 2 }, "room for both agents");
  assert.deepEqual(both.defaults.signees.map((s) => [s.signeeIndex, s.email]), [[0, "morgan@example.com"], [1, "taylor@example.com"]]);

  // a template built for two agents, one signing: Agent 2's blocks come off, or Real's Edit
  // details step stops on "Buyer Agent 2" with nobody assigned (2026-10-14)
  const block = (signeeType, signeeIndex, index) => ({ index, type: "SIGNATURE", signeeType, signeeIndex, fieldLocations: [{ pageNum: 1, position: [0, 0, 1, 1] }] });
  const twoAgents = { pagesCount: 1,
    fieldDefinitions: [block("BUYER", 0, 0), block("BUYERS_AGENT", 0, 1), block("BUYERS_AGENT", 1, 2)],
    documentFieldValidations: [{ fieldIndex: 1, validationType: "REQUIRED" }, { fieldIndex: 2, validationType: "REQUIRED" }],
    signeeConfigs: [{ signeeType: "BUYER", minNum: 0, maxNum: 2 }, { signeeType: "BUYERS_AGENT", minNum: 0, maxNum: 2 }] };
  const one = buildDraftBody({ draft, layout: twoAgents, name: "x", pageCount: 1, transactionId: null, counts: { BUYER: 1, SELLER: 0 }, signees: [],
    sender: senderFor(me, null), agents: { signeeType: "BUYERS_AGENT", people: [team[0]] } });
  assert.deepEqual(one.fieldDefinitions.map((f) => `${f.signeeType}#${f.signeeIndex}`), ["BUYER#0", "BUYERS_AGENT#0"]);
  assert.deepEqual(one.documentFieldValidations, [{ fieldIndex: 1, validationType: "REQUIRED" }], "Agent 2's validation goes with its block");
  assert.deepEqual(one.signeeConfigs.find((c) => c.signeeType === "BUYERS_AGENT"), { signeeType: "BUYERS_AGENT", minNum: 0, maxNum: 1 });
  assert.deepEqual(one.defaults.signees.filter((s) => s.signeeType === "BUYERS_AGENT").map((s) => s.signeeIndex), [0]);
});

test("signers without an email are left off (Real refuses a blank one) and named, slots kept", () => {
  const deal = { participants: [
    { role: "BUYER", firstName: "Jordan", lastName: "Sample", email: "" },
    { role: "BUYER", firstName: "Riley", lastName: "Sample", email: "riley@example.com" },
    { role: "SELLER", firstName: "Casey", lastName: "Placeholder", email: "  " },
  ] };
  const counts = { BUYER: 2, SELLER: 1 };
  assert.deepEqual(signeesFromDeal(deal, counts).map((s) => [s.signeeType, s.signeeIndex, s.email]), [["BUYER", 1, "riley@example.com"]]);
  assert.deepEqual(signersWithoutEmail(deal, counts), [
    { role: "BUYER", slot: 1, name: "Jordan Sample" }, { role: "SELLER", slot: 1, name: "Casey Placeholder" }]);
});

test("draft body without a template still names the signers and carries no blocks", () => {
  const body = buildDraftBody({ draft: { id: "x", name: "x", type: "USER_PDF", pagesCount: null, defaults: null },
    layout: null, name: "Addendum", pageCount: 1, transactionId: null, counts: { BUYER: 1, SELLER: 0 }, signees: [], sender: { email: "alex@example.com" } });
  assert.deepEqual(body.fieldDefinitions, []);
  // minNum 0: a spare signer slot must be deletable in Real Signature
  assert.deepEqual(body.signeeConfigs, [{ signeeType: "BUYER", minNum: 0, maxNum: 1 }]);
  assert.equal(body.defaults.transactionId, null);
});

test("copied template blocks start empty", () => {
  const t = sampleTemplate();
  t.fieldDefinitions[0].defaultValue = "typed on another deal";
  assert.equal(stripTemplate(t).fieldDefinitions[0].defaultValue, null);
});

test("same person in WEBForms and Real: by email only — names can be shared in a family team", () => {
  assert.equal(samePerson({ wfEmail: "Alex@Example.com", rsEmail: "alex@example.com" }), true);
  assert.equal(samePerson({ wfEmail: "alex.jr@example.com", rsEmail: "alex@example.com" }), false, "father and son, same name");
  assert.equal(samePerson({ wfEmail: null, rsEmail: "alex@example.com" }), null, "no email: can't tell");
  const me = meFromYenta({ id: "agent-1", firstName: "Alexander", lastName: "Example", emailAddress: "alex@example.com", type: "AGENT" });
  // the name spelled differently, same email: no note
  assert.deepEqual(actingNotes({ me, deal: null, webformsUserName: "Alex Example", webformsUserEmail: "alex@example.com" }), []);
  // same name, different email: flagged
  const jr = actingNotes({ me, deal: null, webformsUserName: "Alexander Example", webformsUserEmail: "alex.jr@example.com" });
  assert.equal(jr.length, 1);
  assert.equal(jr[0].level, "warn");
  assert.ok(jr[0].text.startsWith("Different people: WEBForms is Alexander Example, Real Signature is"), jr[0].text);
  // no WEBForms email: flagged as unconfirmed, never assumed
  const unknown = actingNotes({ me, deal: null, webformsUserName: "Alexander Example" });
  assert.equal(unknown[0].level, "info");
  assert.match(unknown[0].text, /Couldn't confirm/);
});

test("WEBForms under the agent's own corporation: information, not a warning", () => {
  const p = { rsFirstName: "Jordan", rsLastName: "Sample" };
  for (const wfName of ["Jordan Sample Personal Real Estate Corporation", "Jordan Sample PREC*", "Jordan A. Sample Real Estate Corporation",
    "Jordan Sample Professional Corporation", "Jordan Sample Inc.", "Jordan Sample Ltd", "JORDAN SAMPLE PERSONAL REAL ESTATE CORPORATION"]) {
    assert.equal(isOwnCorporation({ wfName, ...p }), true, wfName);
  }
  assert.equal(isOwnCorporation({ wfName: "Dan Example PREC", rsFirstName: "Daniel", rsLastName: "Example" }), true, "short first name");
  assert.equal(isOwnCorporation({ wfName: "Jordan Sample", ...p }), false, "same name, no corporation: still a different person");
  assert.equal(isOwnCorporation({ wfName: "Casey Sample Personal Real Estate Corporation", ...p }), false, "a relative's corporation");
  assert.equal(isOwnCorporation({ wfName: "Sample Realty Inc.", ...p }), false, "a brokerage, not the person");
  assert.equal(isOwnCorporation({ wfName: "Personal Real Estate Corporation", ...p }), false);

  const me = meFromYenta({ id: "agent-1", firstName: "Jordan", lastName: "Sample", emailAddress: "jordan@example.com", type: "AGENT" });
  const own = actingNotes({ me, deal: null, webformsUserName: "Jordan Sample Personal Real Estate Corporation", webformsUserEmail: "office@example.com" });
  assert.deepEqual(own.map((n) => n.level), ["info"]);
  assert.match(own[0].text, /taken as Jordan Sample's own corporation\. The draft goes in your Drafts, with you as sender\./);
  const other = actingNotes({ me, deal: null, webformsUserName: "Casey Sample Personal Real Estate Corporation", webformsUserEmail: "casey@example.com" });
  assert.deepEqual(other.map((n) => n.level), ["warn"], "someone else's corporation stays a warning");
  // a TC acting for the agent, with WEBForms on the agent's corporation account
  const acting = { id: "agent-1", firstName: "Jordan", lastName: "Sample", fullName: "Jordan Sample", email: "jordan@example.com", actingForAgent: true };
  const tc = actingNotes({ me: acting, deal: null, webformsUserName: "Jordan Sample PREC", webformsUserEmail: "office@example.com" });
  assert.deepEqual(tc.map((n) => n.level), ["info", "info"]);
  assert.match(tc[1].text, /goes in Jordan Sample's Drafts, with them as sender/);
});

test("delegation: a teammate's deal is flagged; a TC acting for an agent is told whose Drafts", () => {
  assert.equal(DELEGATION_VERIFIED, true);
  const me = meFromYenta({ id: "tc-1", firstName: "Taylor", lastName: "Example", emailAddress: "tc@example.com" });
  const deal = summarizeDeal(sampleDealRaw);
  const notes = actingNotes({ me, deal, webformsUserName: "Alex Example", webformsUserEmail: "alex@example.com" });
  assert.equal(notes.length, 2);
  assert.equal(notes[0].level, "warn");
  assert.match(notes[0].text, /Alex Example's/);
  // signed in to WEBForms as someone else: a warning (Dan, 2026-10-15)
  assert.equal(notes[1].level, "warn");
  assert.ok(notes[1].text.includes("Different people: WEBForms is Alex Example, Real Signature is Taylor Example. The draft goes in your Drafts, with you as sender."), notes[1].text);
  assert.deepEqual(actingNotes({ me: { ...me, id: "agent-1", fullName: "Alex Example", email: "alex@example.com" }, deal,
    webformsUserName: "Alex Example", webformsUserEmail: "alex@example.com" }), []);
  assert.equal(senderFor(me, deal).agentYentaId, null);
  // a TC acting for agent-1: info note, no warning on agent-1's own deal, agent is sender
  const agent = { id: deal.ownerId, firstName: "Alex", lastName: "Example", fullName: "Alex Example", email: "alex@example.com", actingForAgent: true };
  const tc = actingNotes({ me: agent, deal, webformsUserName: "Taylor Example", webformsUserEmail: "tc@example.com" });
  // WEBForms as someone else (her own login, or impersonating another agent) while acting
  // as Alex: a warning, since the draft goes in Alex's Drafts
  assert.deepEqual(tc.map((n) => n.level), ["info", "warn"]);
  assert.match(tc[0].text, /Acting as Alex Example in Real Signature/);
  assert.ok(tc[1].text.includes("Different people: WEBForms is Taylor Example, Real Signature is acting as Alex Example. The draft goes in Alex Example's Drafts — if these are Taylor Example's forms, switch \"Acting as\" first."), tc[1].text);
  assert.equal(tc[1].switchTo, "Taylor Example"); // an offer to switch, never forced
  assert.equal(notes[1].switchTo, undefined); // not acting: nothing to switch
  // WEBForms as Alex too (impersonating the same agent): just the info line
  const same = actingNotes({ me: agent, deal, webformsUserName: "Alex Example", webformsUserEmail: "alex@example.com" });
  assert.deepEqual(same.map((n) => n.level), ["info"]);
  assert.equal(senderFor(agent, deal).email, "alex@example.com");
});

test("setup report has counts and yes/no only", () => {
  const r = setupReport({
    rs: { signedIn: true, fullName: "Taylor Example", type: "AGENT", roles: ["ROLE_AGENT", "weird role x@y"], deals: 30, ownDeals: 0, listings: 4, templatesMine: 2, templatesShared: 9, templatesWithBlocks: 6 },
    wf: { signedIn: true, userName: "Alex Example", samePerson: false },
  });
  assert.match(r, /other agents' 30/);
  assert.match(r, /Same person in both: no/);
  for (const leak of ["Taylor", "Alex", "x@y"]) assert.ok(!r.includes(leak), `report leaked ${leak}`);
});

test("setup report says which Real Signature call failed when not signed in", () => {
  const r = setupReport({ rs: { signedIn: false, steps: "token yes, me ok, roles ok, templates ok, shared ok, deals 403" }, wf: null });
  assert.match(r, /Real Signature signed in: no/);
  assert.match(r, /Real Signature calls: .*deals 403/);
});

test("TC acting for an agent: the agent comes from their own deals, never guessed", () => {
  const agent = "00000000-0000-4000-8000-000000000002";
  const deals = [
    { transactionOwner: { id: "someone-else", name: "Casey Other", emailAddress: "casey@example.com" } },
    { transactionOwner: { id: agent, name: "Alex  Example", emailAddress: " alex@example.com " } },
  ];
  assert.deepEqual(meFromDeals(deals, agent),
    { id: agent, firstName: "Alex", lastName: "Example", fullName: "Alex Example", email: "alex@example.com", type: "AGENT" });
  assert.throws(() => meFromDeals(deals.slice(0, 1), agent), /acting for/);
  assert.throws(() => meFromDeals([{ transactionOwner: { id: agent, name: "Alex Example" } }], agent), /acting for/);
  const r = setupReport({ rs: { signedIn: true, actingForAgent: true, type: "AGENT", roles: [], deals: 3, ownDeals: 3, listings: 1, templatesMine: 29, templatesShared: 0, templatesWithBlocks: 20 }, wf: null });
  assert.match(r, /Acting for an agent \(TC\): yes/);
});

test("a subject over 70 is held for the agent, not cut on the way", async () => {
  const { readFile } = await import("node:fs/promises");
  assert.equal(cleanSubject("  Offer  –   120 Example Street NW "), "Offer – 120 Example Street NW");
  assert.equal(subjectTooLong("x".repeat(SUBJECT_MAX)), false);
  assert.equal(subjectTooLong("x".repeat(SUBJECT_MAX + 1)), true);
  assert.equal(subjectTooLong(`  ${"x".repeat(SUBJECT_MAX)}   `), false, "spaces Real trims don't count");
  assert.equal(subjectTooLong(null), false);
  // The panel sends what its field shows, and one click stops rather than sending a long one.
  const panel = await readFile(new URL("../src/panel/panel.js", import.meta.url), "utf8");
  assert.match(panel, /emailSubject: \$\("rs-subject-wrap"\)\.hidden \? null : cleanSubject\(\$\("rs-subject"\)\.value\)/);
  assert.ok(!/emailSubject: subjectFor/.test(panel), "the panel never recomputes the subject behind the field");
  const bg = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  assert.match(bg, /if \(subjectTooLong\(emailSubject\)\)[^\n]*return stop\(/);
  const html = await readFile(new URL("../src/panel/panel.html", import.meta.url), "utf8");
  assert.match(html, /id="rs-subject"/);
});

test("Finish draft stays grey until every form has a template (or No template), and says why", async () => {
  const { readFile } = await import("node:fs/promises");
  const panel = await readFile(new URL("../src/panel/panel.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../src/panel/panel.html", import.meta.url), "utf8");
  assert.match(panel, /return chosen && !tplHeld && !subjectHeld\(\);/);
  assert.match(panel, /function templatesChosen\(\) \{\n  return \(rsState\?\.job\.forms \|\| \[\]\)\.every\(\(_, i\) => !!\$\(`tpl-\$\{i\}`\)\?\.value\);/);
  // Worked out after the templates are drawn, or it reads the old picks.
  assert.match(panel, /renderTemplates\(side\);\n  \$\("rs-go"\)\.disabled = !canFinish\(\);/);
  assert.match(html, /<p class="note" id="rs-go-why" hidden>Choose a template/);
});

test("start-on-click hides the Prepare button while it runs, and brings it back if the start fails", async () => {
  const { readFile } = await import("node:fs/promises");
  const panel = await readFile(new URL("../src/panel/panel.js", import.meta.url), "utf8");
  // Hidden only in the popup, only before the automatic click, only with the setting on.
  assert.match(panel, /\$\("wf-go"\)\.hidden = !!\(POPUP && !autoStarted && \(await settings\(\)\)\.startOnOpen\);/);
  // A failed start shows it again, live, with the title to edit, so the agent can retry.
  assert.match(panel, /\$\("wf-go"\)\.hidden = false;\n    \$\("wf-title-wrap"\)\.hidden = !wfState;[^\n]*\n    \$\("wf-go"\)\.disabled = false;/);
  // No title box while it starts by itself: the title has already gone (Dan, 2026-10-29).
  assert.match(panel, /\$\("wf-title-wrap"\)\.hidden = !!\(POPUP && s\.startOnOpen && !autoStarted\);/);
});
