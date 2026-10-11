// Phase 1 pure modules. Invented data only.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 as zcrc } from "node:zlib";

import { unzip, crc32 } from "../src/lib/unzip.js";
import { isPdf, hasAcroForm, countPages, toBase64, fromBase64 } from "../src/lib/pdf.js";
import { suggestTitle, matchAddress, addressLine } from "../src/lib/title.js";
import { WebForms, isAllowed, readBearer, zipEntryName, pairEntries, WebFormsSignedOut } from "../src/lib/webforms-api.js";
import { buildDraftBody, signeesFromDeal, countsFromDeal } from "../src/lib/draft.js";
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

test("draft body without a template still names the signers and carries no blocks", () => {
  const body = buildDraftBody({ draft: { id: "x", name: "x", type: "USER_PDF", pagesCount: null, defaults: null },
    layout: null, name: "Addendum", pageCount: 1, transactionId: null, counts: { BUYER: 1, SELLER: 0 }, signees: [], sender: { email: "alex@example.com" } });
  assert.deepEqual(body.fieldDefinitions, []);
  assert.deepEqual(body.signeeConfigs, [{ signeeType: "BUYER", minNum: 1, maxNum: 1 }]);
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
