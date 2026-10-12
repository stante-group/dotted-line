// Phase 1 pure modules. Invented data only.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 as zcrc } from "node:zlib";

import { unzip, crc32 } from "../src/lib/unzip.js";
import { isPdf, hasAcroForm, countPages, toBase64, fromBase64 } from "../src/lib/pdf.js";
import { suggestTitle, matchAddress, addressLine } from "../src/lib/title.js";
import { WebForms, isAllowed, readBearer, zipEntryName, pairEntries, WebFormsSignedOut, partiesFromFormValues } from "../src/lib/webforms-api.js";
import { buildDraftBody, signeesFromDeal, countsFromDeal, signersWithoutEmail, signerCounts, sideFromFormNames, templateSlots, agentRoleFor, agentPerson, agentPeople, chooseAgents } from "../src/lib/draft.js";
import { stripTemplate, dropUnusedSlots } from "../src/lib/layout.js";
import { summarizeDeal } from "../src/lib/deals.js";
import { actingNotes, setupReport, senderFor, meFromYenta, DELEGATION_VERIFIED } from "../src/lib/actor.js";
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
  assert.equal(suggestTitle({ transaction: { ...t, City: "" }, forms: [] }), "Offer - Jordan Sample");
});

test("title: standalone forms use form names and the typed-in address", () => {
  const v = { txtp_streetnum: "12", txtp_street: "Sample Avenue SW", txtp_city: "Calgary" };
  assert.equal(suggestTitle({ transaction: null, forms: [{ name: "Addendum.pdf" }], firstFormValues: v }), "Addendum – 12 Sample Avenue SW, Calgary");
  assert.equal(suggestTitle({ transaction: null, forms: [{ name: "A" }, { name: "B" }], firstFormValues: null }), "2 forms");
  assert.equal(addressLine({ streetNumber: "12", streetName: "", city: "Calgary" }), null);
  assert.equal(matchAddress({ transaction: null, firstFormValues: v }), "12 Sample Avenue SW Calgary");
  assert.equal(suggestTitle({ transaction: null, forms: [{ name: "x".repeat(200) }] }).length, 120);
});

test("WEBForms client: only the allowlisted requests, nothing that saves or sends", () => {
  assert.ok(isAllowed("GET", "/api/transactions/Basic/abc"));
  assert.ok(isAllowed("GET", "/api/formeditor/formfields/abc"));
  assert.ok(isAllowed("POST", "/api/Transfer/CreateDownloadRequest"));
  assert.ok(isAllowed("GET", "/api/Transfer/downloadmany"));
  for (const [m, p] of [["PUT", "/api/formeditor/saveForm/abc"], ["POST", "/api/formeditor/saveMarkups/abc"],
    ["POST", "/api/AppsStore/SendItems"], ["GET", "/api/Transfer/printpdf"], ["GET", "/api/Transfer/downloadsingle"],
    ["DELETE", "/api/forms/abc"], ["POST", "/api/transactions/Basic/abc"]]) {
    assert.ok(!isAllowed(m, p), `${m} ${p} must be refused`);
  }
  assert.equal(readBearer('"tok"'), "tok");
  assert.equal(readBearer("not json"), null);
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
  assert.match(r.why, /only has seller blocks.*template has blocks for 3 sellers/);
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

test("WEBForms name lines → buyer/seller counts; a shared line counts as two, a company as one", () => {
  assert.deepEqual(partiesFromFormValues({ txtbuyer1: "Jordan Sample", txtbuyer2: "", txtseller1: "Casey & Riley Placeholder", txtseller2: "Sam Placeholder" }),
    { BUYER: 1, SELLER: 3 });
  assert.deepEqual(partiesFromFormValues({ txtbuyer1: "Example Holdings Ltd. and Sons", txtbuyersig1: "Jordan Sample", txtbuyersig2: "Riley Sample" }),
    { BUYER: 2, SELLER: 0 });
  assert.deepEqual(partiesFromFormValues({}), { BUYER: 0, SELLER: 0 });
  assert.deepEqual(partiesFromFormValues(null), { BUYER: 0, SELLER: 0 });
  // feeds the count, never lowers it, never picks the side
  const offer = ["Residential Purchase Contract"];
  const r = signerCounts({ deal: null, formNames: offer, webforms: [{ BUYER: 1, SELLER: 3 }] });
  assert.deepEqual(r.counts, { BUYER: 2, SELLER: 3 });
  assert.match(r.why, /WEBForms names look like 3 sellers/);
  assert.deepEqual(signerCounts({ deal: { side: "BUYER", participants: [] }, formNames: offer, webforms: [{ BUYER: 1, SELLER: 3 }] }).counts, { BUYER: 2, SELLER: 0 });
});

test("the agent as a signer: role from the template or the side, person from the deal, never a TC", () => {
  const cfg = (...types) => ({ signeeConfigs: types.map((signeeType) => ({ signeeType, minNum: 0, maxNum: 1 })) });
  assert.equal(agentRoleFor({ layout: cfg("SELLER", "SELLERS_AGENT") }), "SELLERS_AGENT");
  assert.equal(agentRoleFor({ layout: cfg("BUYER") }), null, "template without agent blocks: the agent doesn't sign it");
  assert.equal(agentRoleFor({ layout: null, counts: { BUYER: 2, SELLER: 0 } }), "BUYERS_AGENT");
  assert.equal(agentRoleFor({ layout: null, counts: { BUYER: 2, SELLER: 2 } }), null, "dual without a template: can't tell");

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

test("delegation framework: another agent's deal is flagged until verified", () => {
  assert.equal(DELEGATION_VERIFIED, false);
  const me = meFromYenta({ id: "tc-1", firstName: "Taylor", lastName: "Example", emailAddress: "tc@example.com" });
  const deal = summarizeDeal(sampleDealRaw);
  const notes = actingNotes({ me, deal, webformsUserName: "Alex Example" });
  assert.equal(notes.length, 2);
  assert.match(notes[0], /Alex Example's/);
  assert.match(notes[1], /WEBForms is signed in as Alex Example/);
  assert.deepEqual(actingNotes({ me: { ...me, id: "agent-1", fullName: "Alex Example" }, deal, webformsUserName: "Alex Example" }), []);
  assert.equal(senderFor(me, deal).agentYentaId, null);
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
