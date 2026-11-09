// Reading where a PDF's words are, and placing blocks from a form's printed labels.
// Invented forms only: the PDFs are built here, never copied from a real form.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

import { readPdfText, md5, rc4 } from "../src/lib/pdftext.js";
import { pageBlocks, autoLayout, forAgent, forClients, withSigners, toLines, isLease } from "../src/lib/autoplace.js";
import { placeOutcome, assignSlots, clientsLeft, leftNote, formSides } from "../src/lib/autoplace.js";

const enc = (s) => new TextEncoder().encode(s);
const latin = (u8) => new TextDecoder("latin1").decode(u8);

/** A one-page Helvetica PDF from a content stream; optionally Flate and RC4-locked the way
 *  WEBForms locks its PDFs (Standard handler, R3, 128-bit, empty user password). */
function makePdf(content, { flate = false, lock = false, font = null } = {}) {
  let data = enc(content);
  if (flate) data = new Uint8Array(deflateSync(data));
  const id = enc("0123456789abcdef");
  const O = enc("O".repeat(32));
  const P = -1028;
  let key = null;
  if (lock) {
    // Algorithm 2 written out again here, with Node's own MD5, so the reader is checked
    // against an independent copy rather than itself.
    const pad = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
    const p = Buffer.alloc(4); p.writeInt32LE(P);
    let k = createHash("md5").update(Buffer.concat([pad, O, p, id])).digest().subarray(0, 16);
    for (let i = 0; i < 50; i++) k = createHash("md5").update(k).digest().subarray(0, 16);
    key = k;
    const objKey = createHash("md5").update(Buffer.concat([key, Buffer.from([4, 0, 0, 0, 0])])).digest().subarray(0, 16);
    data = rc4(objKey, data);
  }
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    null, // the content stream
    ...(font || ["<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"]),
  ];
  if (lock) objs.push(`<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O <${Buffer.from(O).toString("hex")}> /U <${"00".repeat(32)}> >>`);
  const parts = [enc("%PDF-1.4\n")];
  const offsets = [];
  let len = parts[0].length;
  objs.forEach((o, i) => {
    const head = enc(`${i + 1} 0 obj\n`);
    const body = o === null
      ? [enc(`<< /Length ${data.length}${flate ? " /Filter /FlateDecode" : ""} >>\nstream\n`), data, enc("\nendstream\nendobj\n")]
      : [enc(`${o}\nendobj\n`)];
    offsets.push(len);
    for (const b of [head, ...body]) { parts.push(b); len += b.length; }
  });
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${lock ? ` /Encrypt ${objs.length} 0 R /ID [<${Buffer.from(id).toString("hex")}> <${Buffer.from(id).toString("hex")}>]` : ""} >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(enc(trailer));
  return new Uint8Array(Buffer.concat(parts));
}

// Courier is 600 units a character, so positions are easy to check by hand.
const FORM = [
  "0 0 0 RG 72 120 m 300 120 l S", // the line a seller signs on
  "BT /F1 10 Tf 72 110 Td (Signature of Seller) Tj ET",
  "BT /F1 10 Tf 72 40 Td (Seller's Initials ________ ________ Page 1 of 1) Tj ET",
].join("\n");

test("md5 and rc4 match their published test values", () => {
  assert.equal(Buffer.from(md5(enc(""))).toString("hex"), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(Buffer.from(md5(enc("The quick brown fox jumps over the lazy dog"))).toString("hex"), "9e107d9d372bb6826bd81d3542a419d6");
  assert.equal(Buffer.from(rc4(enc("Key"), enc("Plaintext"))).toString("hex"), "bbf316e8d940af0ad3");
});

test("reads words and their positions from a plain, a compressed and a locked PDF", async () => {
  for (const opts of [{}, { flate: true }, { flate: true, lock: true }]) {
    const pdf = makePdf(FORM, opts);
    assert.equal(latin(pdf).includes("Signature of Seller"), !opts.flate, "the test PDF hides its words when it should");
    const [page] = await readPdfText(pdf);
    assert.equal(page.width, 612);
    const sig = page.items.find((i) => i.str === "Signature of Seller");
    assert.ok(sig, `found the label (${JSON.stringify(opts)})`);
    assert.equal(sig.x, 72);
    assert.equal(sig.y, 110);
    assert.equal(sig.w, 19 * 6); // 19 characters × 600/1000 × 10pt
    assert.deepEqual(page.shapes[0], { x1: 72, y1: 120, x2: 300, y2: 120 });
  }
});

// A Type0 font with no ToUnicode and no cmap, so its codes are glyph numbers: object 6 is
// the CID font, 1000 units a glyph.
const glyphFont = (base) => [
  `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [6 0 R] >>`,
  `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDToGIDMap /Identity /DW 1000
     /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>`,
];
const glyphHex = (s, shift, quote) => [...s].map((ch) => (ch === " " ? 3 : ch === "\u2019" ? quote : ch.charCodeAt(0) - shift)
  .toString(16).padStart(4, "0")).join("");

test("glyph-number fonts: the Macintosh order, and Apple's Helvetica Neue four places along", async () => {
  const label = "Seller\u2019s Signature, 2026/10";
  for (const [base, shift, quote] of [["ABCDEF+ArialMT", 29, 198], ["OITECW+HelveticaNeue", 25, 187], ["HelveticaNeue-Bold", 25, 187]]) {
    const [page] = await readPdfText(makePdf(`BT /F1 10 Tf 72 110 Td <${glyphHex(label, shift, quote)}> Tj ET`, { font: glyphFont(base) }));
    assert.equal(page.items[0]?.str, "Seller's Signature, 2026/10", base);
  }
  // Helvetica Neue LT Std is Linotype's, not Apple's: left in the Macintosh order.
  const [lt] = await readPdfText(makePdf(`BT /F1 10 Tf 72 110 Td <${glyphHex("Signature", 29, 198)}> Tj ET`, { font: glyphFont("HelveticaNeueLTStd-Md") }));
  assert.equal(lt.items[0]?.str, "Signature");
});

test("a PDF with a real password is refused, not misread", async () => {
  const pdf = latin(makePdf(FORM, { lock: true })).replace("/R 3 /Length 128", "/R 6 /Length 256");
  await assert.rejects(readPdfText(new Uint8Array(Buffer.from(pdf, "latin1"))), /password/);
});

test("a signature label under a line puts a signature block on the line", async () => {
  const [page] = await readPdfText(makePdf(FORM));
  const blocks = pageBlocks(page);
  const sig = blocks.find((b) => b.spec.type === "SIGNATURE");
  assert.equal(sig.role, "SELLER");
  assert.equal(sig.x, 74); // the line's start, 2pt in
  assert.equal(sig.y, 121); // sitting on the line
});

test("a footer's initials runs become Seller 1 and Seller 2 on every page", async () => {
  const pdf = await readPdfText(makePdf(FORM));
  const { layout } = autoLayout([pdf[0], pdf[0]]);
  const ini = layout.fieldDefinitions.filter((f) => f.type === "INITIALS");
  assert.deepEqual(ini.map((f) => [f.fieldLocations[0].pageNum, f.signeeIndex]), [[1, 0], [1, 1], [2, 0], [2, 1]]);
  assert.equal(layout.pagesCount, 2);
  assert.deepEqual(layout.signeeConfigs, [{ signeeType: "SELLER", minNum: 0, maxNum: 2 }]);
  // Signatures and initials are required; every block has its own index.
  assert.equal(layout.documentFieldValidations.length, layout.fieldDefinitions.length);
  assert.deepEqual(layout.fieldDefinitions.map((f) => f.index), layout.fieldDefinitions.map((_, i) => i));
});

// Pages as pdftext.js returns them, written by hand: {str, x, y, w, size, xs}.
const word = (str, x, y, size = 9) => ({ str, x, y, w: str.length * size * 0.5, size, xs: str.split("").map((_, i) => x + i * size * 0.5) });
const page = (items, shapes = []) => ({ width: 612, height: 792, items, shapes });
const rule = (x1, x2, y) => ({ x1, y1: y, x2, y2: y });

test("Alberta purchase contract: each signer's date goes with the signature line below it", () => {
  const p = page([
    word("Signed and dated at ________. m. on ____________________, 20___.", 36, 653),
    word("Buyer Signature", 36, 628), word("Witness Signature", 220, 628),
    word("Signed and dated at ________. m. on ____________________, 20___.", 36, 606),
    word("Buyer Signature", 36, 580), word("Witness Signature", 220, 580),
  ], [rule(36, 200, 637), rule(220, 400, 637), rule(36, 200, 589), rule(220, 400, 589)]);
  const { layout } = autoLayout([p]);
  const got = layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType} ${f.signeeIndex}`);
  // The form has its own time blank, so time and date are separate stamps.
  assert.deepEqual(got, ["SIGNED_TIME_ONLY BUYER 0", "SIGNED_DATE_ONLY BUYER 0", "SIGNATURE BUYER 0",
    "SIGNED_TIME_ONLY BUYER 1", "SIGNED_DATE_ONLY BUYER 1", "SIGNATURE BUYER 1"]);
  // Witnesses have no Real Signature role: their lines get nothing.
  assert.ok(!layout.fieldDefinitions.some((f) => f.fieldLocations[0].position[0] >= 220));
  // The time sits on the blank after "at", the date on the one after "on".
  const at = (type) => layout.fieldDefinitions.find((f) => f.type === type).fieldLocations[0].position[0];
  assert.equal(at("SIGNED_TIME_ONLY"), 36 + "Signed and dated at ".length * 4.5 + 1);
  assert.ok(at("SIGNED_DATE_ONLY") > 36 + "Signed and dated at ________. m. on".length * 4.5 - 1, `date at x=${at("SIGNED_DATE_ONLY")}`);
});

test("Manitoba: bare Buyer / Seller names under lines, and initials in drawn boxes", () => {
  const p = page([
    word("Buyer", 30, 300), word("Buyer", 330, 300),
    word("Witness", 30, 200), word("Seller", 330, 200),
    word("Initials (Buyer)", 80, 100), word("Initials (Seller's brokerage representative)", 380, 100),
    word("The Buyer:", 30, 400), // a heading, no line over it
  ], [
    rule(28, 280, 310), rule(328, 580, 310), rule(28, 280, 210), rule(328, 580, 210),
    { rect: true, x1: 50, y1: 97, x2: 76, y2: 112 }, { rect: true, x1: 350, y1: 97, x2: 376, y2: 112 },
  ]);
  const b = pageBlocks(p);
  assert.deepEqual(b.filter((x) => x.sig).map((x) => [x.role, x.x]), [["BUYER", 30], ["BUYER", 330], ["SELLER", 330]]);
  const ini = b.filter((x) => x.spec.type === "INITIALS");
  assert.deepEqual(ini.map((x) => [x.role, x.x, x.y, x.w]), [["BUYER", 51, 98, 24], ["SELLERS_AGENT", 351, 98, 24]]);
});

test("headings and sentences about signing aren't lines to sign on", () => {
  const p = page([
    word("Date and Buyer’s Signature", 72, 305),
    word("the seller's signature is required", 72, 280),
    word("Date of the Offer to Purchase Contract:", 72, 250),
    word("Signature of brokerage representative", 300, 200), // Manitoba's cash-deposit receipt
  ], [rule(72, 400, 312), rule(300, 500, 210)]);
  assert.deepEqual(pageBlocks(p), []);
});

test("lines put a run's words back together, with a space where the PDF left a gap", () => {
  const lines = toLines([word("Buyer", 30, 100), word("Signature", 30 + 5 * 4.5 + 4, 100.4), word("x", 30, 50)]);
  assert.deepEqual(lines.map((l) => l.text), ["Buyer Signature", "x"]);
});

test("agent lines: the signing agent keeps theirs, the other side's come off", () => {
  const p = page([
    word("Initials (Buyer's brokerage representative)", 80, 120), word("Initials (Seller's brokerage representative)", 380, 120),
    word("Signature of Brokerage Representative", 30, 60),
  ], [{ rect: true, x1: 50, y1: 117, x2: 76, y2: 132 }, { rect: true, x1: 350, y1: 117, x2: 376, y2: 132 }, rule(28, 280, 70)]);
  const { layout } = autoLayout([p]);
  const mine = forAgent(layout, "SELLERS_AGENT");
  assert.deepEqual(mine.fieldDefinitions.map((f) => `${f.type} ${f.signeeType}`).sort(), ["INITIALS SELLERS_AGENT", "SIGNATURE SELLERS_AGENT"]);
  assert.deepEqual(mine.signeeConfigs, [{ signeeType: "SELLERS_AGENT", minNum: 0, maxNum: 1 }]);
  assert.equal(forAgent(layout, null).fieldDefinitions.length, 0);
});

test("every signer the counts ask for is set up, even with no line on the form", () => {
  const l = { pagesCount: 1, fieldDefinitions: [], documentFieldValidations: [], signeeConfigs: [{ signeeType: "BUYER", minNum: 0, maxNum: 1 }] };
  assert.deepEqual(withSigners(l, { BUYER: 2, SELLER: 1 }).signeeConfigs, [
    { signeeType: "BUYER", minNum: 0, maxNum: 2 }, { signeeType: "SELLER", minNum: 0, maxNum: 1 }]);
});

test("a form with no labels it knows places nothing", () => {
  assert.equal(autoLayout([page([word("Schedule A", 72, 700)])]).layout, null);
});

test("Ontario: dotted lines over (Buyer) and (Date), groups numbered apart, footer ovals", () => {
  const dots = (x, y) => word(".".repeat(40), x, y);
  const p = page([
    dots(40, 709), dots(355, 709), dots(500, 709), word("(Witness) (Buyer) (Seal) (Date)", 40, 702),
    dots(40, 683), dots(355, 683), dots(500, 683), word("(Witness) (Buyer) (Seal) (Date)", 40, 676),
    // The acknowledgement, further down: its buyers are Buyer 1 and 2 again.
    dots(40, 290), dots(300, 290), word("(Buyer) (Date)", 40, 284),
    dots(40, 270), dots(300, 270), word("(Buyer) (Date)", 40, 264),
    word("(Signature of Seller or Buyer)", 300, 445), // confirmation of acceptance: either party
    word("(Witness) (Spouse) (Seal) (Date)", 40, 514),
    word("INITIALS OF BUYER(S):", 183, 79, 8),
  ]);
  const { layout } = autoLayout([p]);
  const got = layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType}${f.signeeIndex + 1}`);
  assert.deepEqual(got.filter((g) => g.startsWith("SIGNATURE")), ["SIGNATURE BUYER1", "SIGNATURE BUYER2", "SIGNATURE BUYER1", "SIGNATURE BUYER2"]);
  assert.equal(got.filter((g) => g.startsWith("SIGNED_DATE")).join(), "SIGNED_DATE BUYER1,SIGNED_DATE BUYER2,SIGNED_DATE BUYER1,SIGNED_DATE BUYER2");
  assert.deepEqual(got.filter((g) => g.startsWith("INITIALS")), ["INITIALS BUYER1", "INITIALS BUYER2"]);
  assert.ok(!got.some((g) => g.includes("SELLER")), "nothing for the seller-or-buyer line or the spouse");
  // The signature sits on its own row's dots, not the row above.
  const first = layout.fieldDefinitions.find((f) => f.type === "SIGNATURE").fieldLocations[0].position;
  assert.equal(first[1], 710);
});

test("Consumer Relationships Guide: lines that run on from the label, for the side that signs", () => {
  const p = page([
    word("Signed on _____________________, 20__.", 38, 111, 10),
    word("Consumer Signature", 38, 57, 10), word("Consumer Signature", 330, 57, 10),
  ], [rule(134, 278, 57), rule(427, 571, 57)]);
  const { layout } = autoLayout([p]);
  assert.deepEqual(layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType}${f.signeeIndex + 1} x${f.fieldLocations[0].position[0]}`),
    ["SIGNED_DATE CLIENT1 x90", "SIGNATURE CLIENT1 x136", "SIGNATURE CLIENT2 x429"]);
  const sellers = forClients(layout, { BUYER: 0, SELLER: 1 });
  assert.deepEqual(sellers.fieldDefinitions.map((f) => `${f.signeeType}${f.signeeIndex + 1}`), ["SELLER1", "SELLER1"]);
  assert.deepEqual(sellers.signeeConfigs, [{ signeeType: "SELLER", minNum: 0, maxNum: 1 }]);
  // Both sides signing: nothing says whose guide it is, so the agent places them.
  assert.equal(forClients(layout, { BUYER: 2, SELLER: 2 }).fieldDefinitions.length, 0);
});

test("Referral Fee Consent: the referred client signs, whichever side they are", () => {
  const p = page([
    word("SIGNED AND DATED on ______________________________, 20_____.", 36, 196, 10),
    word("Signature of Referred Client", 60, 167, 9), word("Signature of Referred Client", 330, 167, 9),
    word("Signature of Witness", 60, 113, 9), word("Signature of Witness", 330, 113, 9),
  ], [rule(36, 280, 176), rule(320, 571, 176), rule(36, 280, 122), rule(320, 571, 122)]);
  const { layout } = autoLayout([p]);
  const got = layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType}${f.signeeIndex + 1}`);
  assert.deepEqual(got.filter((g) => g.startsWith("SIGNATURE")), ["SIGNATURE CLIENT1", "SIGNATURE CLIENT2"]);
  assert.ok(!got.some((g) => /WITNESS/.test(g)), "witness lines are left for the agent");
  const buyer = forClients(layout, { BUYER: 1, SELLER: 0 });
  assert.ok(buyer.fieldDefinitions.length > 0 && buyer.fieldDefinitions.every((f) => f.signeeType === "BUYER" && f.signeeIndex === 0));
});

test("customer forms: the title names the customer's side, or nobody's lines are placed", () => {
  // A customer is someone the agent does NOT represent, on either side, so only the form says.
  const lines = (title, label) => page([
    word(title, 60, 740, 12),
    word("SIGNED AND DATED on ______________________________, 20_____.", 36, 196, 10),
    word(`${label}       ${label}`, 60, 167, 9),
    word("Signature of Real Estate Brokerage Representative", 60, 100, 9),
  ], [rule(36, 260, 176), rule(300, 540, 176), rule(36, 300, 109)]);
  const placed = (pg) => (autoLayout([pg]).layout?.fieldDefinitions || []).map((f) => `${f.type} ${f.signeeType}${f.signeeIndex + 1}`);
  assert.deepEqual(placed(lines("COMMERCIAL TENANT CUSTOMER DISCLOSURE ACKNOWLEDGMENT", "Signature of Customer")),
    ["SIGNED_DATE BUYER1", "SIGNATURE BUYER1", "SIGNATURE BUYER2", "SIGNATURE AGENT1"]);
  assert.deepEqual(placed(lines("SELLER CUSTOMER STATUS ACKNOWLEDGMENT AND FEE AGREEMENT", "Signature of Customer")),
    ["SIGNED_DATE SELLER1", "SIGNATURE SELLER1", "SIGNATURE SELLER2", "SIGNATURE AGENT1"]);
  // No side named: the customers' lines are left, and the agent's own line gets the date.
  assert.deepEqual(placed(lines("CUSTOMER ACKNOWLEDGEMENT", "Signature of Seller/Buyer")), ["SIGNED_DATE AGENT1", "SIGNATURE AGENT1"]);
  const footer = page([word("CUSTOMER ACKNOWLEDGEMENT", 60, 740, 12),
    word("Seller’s/Buyer’s Initials ______ ______ Brokerage Representative’s Initials ______", 200, 54, 8)]);
  assert.deepEqual(placed(footer), ["INITIALS AGENT1"]);
  // What's left is counted, for the panel's note.
  assert.deepEqual(autoLayout([lines("CUSTOMER ACKNOWLEDGEMENT", "Signature of Seller/Buyer")]).left, { customer: 2 });
  assert.deepEqual(autoLayout([lines("SELLER CUSTOMER STATUS ACKNOWLEDGMENT AND FEE AGREEMENT", "Signature of Customer")]).left, { customer: 0 });
  // Off a customer form, a "Signature of Customer" line is nobody's.
  assert.deepEqual(placed(lines("SOME OTHER FORM", "Signature of Customer")).filter((g) => g.startsWith("SIGNATURE ")), ["SIGNATURE AGENT1"]);
});

test("the title is the form's own: the largest line, not a mention of another form", () => {
  const sides = (heads) => formSides([page(heads.map(([t, y, size]) => word(t, 60, y, size)))]);
  // AREA's schedules: the agreement they belong to, largest, over their own name. Its side is theirs.
  assert.equal(sides([["EXCLUSIVE SELLER REPRESENTATION AGREEMENT", 717, 13], ["TENANCY SCHEDULE", 701, 11]]).party, "SELLER");
  // A smaller header line naming another form says nothing about this one.
  const other = sides([["Prepared for use with the Exclusive Buyer Representation Agreement".toUpperCase(), 760, 8], ["NOTICE TO PARTIES", 717, 13]]);
  assert.deepEqual(other, { party: null, signer: null });
  assert.ok(!("customer" in sides([["See also the Customer Acknowledgement".toUpperCase(), 760, 8], ["DISCLOSURE", 717, 13]])));
  // At title size too: "Schedule to the …", on one line or wrapped onto the next.
  assert.equal(sides([["SCHEDULE TO THE EXCLUSIVE SELLER REPRESENTATION AGREEMENT", 717, 13]]).party, null);
  assert.equal(sides([["ADDENDUM TO THE", 730, 13], ["EXCLUSIVE BUYER REPRESENTATION AGREEMENT", 717, 13]]).party, null);
  assert.equal(sides([["This form is attached to and forms part of the Certificate and Consent of Purchaser", 748, 18]]).signer, null);
  // Its own title still counts when another form is named after it.
  assert.equal(sides([["EXCLUSIVE BUYER REPRESENTATION AGREEMENT", 717, 13], ["AMENDMENT TO THE CUSTOMER ACKNOWLEDGEMENT", 702, 13]]).party, "BUYER");
  assert.equal(sides([["COMMERCIAL TENANT CUSTOMER DISCLOSURE ACKNOWLEDGMENT", 717, 13]]).customer, "BUYER");
  assert.equal(sides([["REALTOR® Cooperation Disclosure and Consent Form", 740, 24]]).signer, "SELLER");
});

test("a seller representation agreement's bare signing-officer lines are the seller's", () => {
  const p = page([
    word("COMMERCIAL EXCLUSIVE SELLER REPRESENTATION AGREEMENT", 60, 740, 12),
    word("Authorized Signing Officer(s)            Witness", 60, 300, 9),
    word("Signature of Brokerage Representative", 60, 200, 9),
  ], [rule(36, 260, 309), rule(36, 260, 209)]);
  const got = autoLayout([p]).layout.fieldDefinitions.map((f) => `${f.signeeType}${f.signeeIndex + 1}`);
  assert.deepEqual(got, ["SELLER1", "AGENT1"]);
});

test("a row of possessive signature labels, and the Fee Disclosure's client initials", () => {
  const p = page([
    word("Seller’s Signature                        Buyer’s Signature", 60, 167, 9),
    word("Date and Buyer’s Signature", 60, 400, 9), // a heading, not a line to sign on
    word("Client: Initial here to show you have received a copy of this Disclosure ________", 36, 100, 9),
  ], [rule(36, 200, 176), rule(240, 420, 176), rule(36, 200, 409)]);
  const got = autoLayout([p]).layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType}${f.signeeIndex + 1}`);
  assert.deepEqual(got.sort(), ["INITIALS CLIENT1", "SIGNATURE BUYER1", "SIGNATURE SELLER1"]);
});

test("dates and times are required too: Real Signature only stamps one the signer clicks", () => {
  const p = page([
    word("Signed and dated at ________. m. on ____________________, 20___.", 36, 653),
    word("Buyer Signature", 36, 628),
  ], [rule(36, 200, 637)]);
  const { layout } = autoLayout([p]);
  assert.equal(layout.fieldDefinitions.length, 3);
  assert.deepEqual(layout.documentFieldValidations.map((v) => [v.validationType, v.fieldIndex]),
    [["REQUIRED", 0], ["REQUIRED", 1], ["REQUIRED", 2]]);
});

test("why a form got no blocks: locked, unreadable, no text, unmapped fonts, or labels we don't know", () => {
  const page = (str) => [{ width: 612, height: 792, items: str ? [{ str, x: 0, y: 0, w: 10, size: 10, xs: [] }] : [], shapes: [] }];
  assert.equal(placeOutcome({ error: new Error("this PDF has a password") }), "pdf-locked");
  assert.equal(placeOutcome({ error: new Error("bad xref") }), "pdf-unreadable");
  assert.equal(placeOutcome({ pages: page("Signature of Buyer"), blocks: 3 }), null);
  assert.equal(placeOutcome({ pages: page(""), blocks: 0 }), "no-text");
  assert.equal(placeOutcome({ pages: page("Xq#7 zzv Kp!r wq Mxx ql0 Zp vrr"), blocks: 0 }), "fonts");
  assert.equal(placeOutcome({ pages: page("The buyer and the seller agree to the terms of the offer and the deposit."), blocks: 0 }), "no-labels");
  assert.equal(placeOutcome({ pages: page("Le vendeur et l'acheteur de la propriété acceptent les conditions de la promesse."), blocks: 0 }), "no-labels");
});

test("an inline image doesn't derail the page: lines and words after it still count", async () => {
  // Its bytes would read as an unclosed string, swallowing the rest of the page.
  const pdf = await readPdfText(makePdf([
    "q 20 0 0 20 72 700 cm BI /W 4 /H 1 /BPC 8 /CS /G ID ((((<<[ EI Q",
    "0 0 0 RG 72 120 m 300 120 l S",
    "BT /F1 10 Tf 72 108 Td (Signature of Seller) Tj ET",
  ].join("\n")));
  assert.equal(pdf[0].shapes.length, 1);
  assert.ok(pdf[0].items.some((i) => i.str === "Signature of Seller"));
});

// Saskatchewan (SREC / Saskatchewan REALTORS® Association) wording, written out by hand.
test("Saskatchewan purchase contract: capital-letter signature lines, and the SIGNED AND SEALED date", () => {
  const p = page([
    word("SIGNED AND SEALED by the Buyer at ____________ on the _______ day of ____________________, ", 38, 312),
    word("WITNESS", 38, 280), word("BUYER' SIGNATURE_____________________________________", 308, 280),
    word("WITNESS", 38, 259), word("BUYER' SIGNATURE_____________________________________", 308, 259),
    word("BUYER'S SOLICITOR", 38, 79), word("SELLER'S SOLICITOR____________________", 308, 79), // a name, not a signature
  ], [rule(76, 272, 279), rule(76, 272, 257)]);
  const { layout } = autoLayout([p]);
  const got = layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType} ${f.signeeIndex}`);
  assert.deepEqual(got, ["SIGNED_DATE BUYER 0", "SIGNATURE BUYER 0", "SIGNATURE BUYER 1"]);
  // The date goes on the month blank after "day of" ("at" is a place: no time block).
  const date = layout.fieldDefinitions[0].fieldLocations[0].position[0];
  assert.ok(date > 38 + "SIGNED AND SEALED by the Buyer at ____________ on the _______ day of".length * 4.5, `date at ${date}`);
});

test("Saskatchewan rows of names under lines: sellers, the brokerage, and a bare Signature for the client", () => {
  const p = page([
    word("SIGNED at ____________ on mm ______ dd ______ yyyy ____________.", 29, 190),
    word("WITNESS", 29, 120), word("SELLER", 195, 120), word("Authorized Brokerage Representative", 407, 120, 8),
    word("WITNESS", 29, 88), word("SELLER", 195, 88), word("Witness", 407, 88, 8),
  ], [rule(29, 186, 128), rule(195, 369, 128), rule(408, 569, 128), rule(29, 186, 96), rule(195, 369, 96), rule(407, 569, 96)]);
  const { layout } = autoLayout([p]);
  const got = layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType} ${f.signeeIndex}`);
  assert.deepEqual(got, ["SIGNED_DATE SELLER 0", "SIGNATURE SELLER 0", "SIGNATURE AGENT 0", "SIGNATURE SELLER 1"]);
  // Agency Disclosure: "Witness          Signature", the client's line on the right.
  const q = page([word("Witness", 36, 114), word("Signature", 324, 114), word("Witness", 36, 87), word("Signature", 324, 87)],
    [rule(36, 276, 122), rule(324, 558, 122), rule(36, 276, 95), rule(324, 558, 95)]);
  const c = autoLayout([q]).layout.fieldDefinitions;
  assert.deepEqual(c.map((f) => `${f.signeeType} ${f.signeeIndex} x${f.fieldLocations[0].position[0]}`), ["CLIENT 0 x326", "CLIENT 1 x326"]);
  // The lower box stops short of the row above's label instead of covering it.
  const [top, low] = c.map((f) => f.fieldLocations[0].position);
  assert.ok(low[3] < 114 - 1, `lower box reaches y=${low[3]}`);
  assert.ok(top[3] - top[1] > low[3] - low[1]);
});

test("Saskatchewan footer: both sellers' initials on the line over \"Seller(s) Initials\"", () => {
  const p = page([word("___________________", 479, 89, 8), word("Seller(s) Initials", 492, 80, 8)]);
  const ini = autoLayout([p]).layout.fieldDefinitions;
  assert.deepEqual(ini.map((f) => `${f.type} ${f.signeeType} ${f.signeeIndex}`), ["INITIALS SELLER 0", "INITIALS SELLER 1"]);
  const [a, b] = ini.map((f) => f.fieldLocations[0].position);
  assert.ok(a[2] <= b[0] && b[2] <= 479 + 19 * 4 + 1, "side by side, on the line");
});

// British Columbia (BCREA, BCFSA) wording, written out by hand.
const box = (x1, y1, x2, y2) => ({ rect: true, x1, y1, x2, y2 });

test("BC footer initials: a cell per signer, for whoever signs the form; choice boxes higher up stay empty", () => {
  const cells = [box(467, 83, 506, 110), box(506, 83, 545, 110), box(545, 83, 585, 110)];
  const p1 = page([word("INITIALS", 506, 72, 10)], cells);
  const p2 = page([
    word("RESIDENT OF CANADA", 150, 440), word("INITIALS", 250, 424, 7), // a choice: not every seller initials it
    word("SELLER'S SIGNATURE", 42, 362, 7), word("SELLER'S SIGNATURE", 227, 362, 7),
    word("DESIGNATED AGENT'S SIGNATURE", 335, 276, 7),
  ], [box(240, 430, 270, 455), rule(42, 210, 371), rule(227, 393, 371), rule(335, 585, 285)]);
  const f = autoLayout([p1, p2]).layout.fieldDefinitions.map((d) => `p${d.fieldLocations[0].pageNum} ${d.type} ${d.signeeType} ${d.signeeIndex}`);
  assert.deepEqual(f.sort(), ["p1 INITIALS SELLER 0", "p1 INITIALS SELLER 1", "p1 INITIALS SELLER 2",
    "p2 SIGNATURE AGENT 0", "p2 SIGNATURE SELLER 0", "p2 SIGNATURE SELLER 1"]);
  // With nobody's signature line on the form, nobody can be said to initial: none placed.
  assert.equal(autoLayout([p1]).layout, null);
});

test("BC rows: SIGNATURE and DATE under lines, each date with the signature above it", () => {
  const p = page([
    word("SIGNATURE", 29, 158, 7), word("SIGNATURE", 224, 158, 7), word("SIGNATURE", 418, 158, 7),
    word("DATE", 29, 135, 7), word("DATE", 224, 135, 7), word("DATE", 418, 135, 7),
  ], [rule(29, 200, 166), rule(224, 395, 166), rule(418, 590, 166), rule(29, 200, 143), rule(224, 395, 143), rule(418, 590, 143)]);
  const f = autoLayout([p]).layout.fieldDefinitions;
  const at = (t) => f.filter((d) => d.type === t).map((d) => `${d.signeeType} ${d.signeeIndex} x${Math.round(d.fieldLocations[0].position[0])}`);
  assert.deepEqual(at("SIGNATURE"), ["CLIENT 0 x31", "CLIENT 1 x226", "CLIENT 2 x420"]);
  assert.deepEqual(at("SIGNED_DATE"), ["CLIENT 0 x31", "CLIENT 1 x226", "CLIENT 2 x420"]);
});

test("BC release: SIGNATURE OF / SELLER(S): over two lines, its long line shared by two sellers", () => {
  const p = page([word("SIGNATURE OF", 72, 383, 14), word("SELLER(S):", 72, 363, 14)], [rule(163, 545, 358)]);
  const f = autoLayout([p]).layout.fieldDefinitions;
  assert.deepEqual(f.map((d) => `${d.signeeType} ${d.signeeIndex} x${d.fieldLocations[0].position[0]}`), ["SELLER 0 x165", "SELLER 1 x319"]);
});

test("BCFSA remuneration: fake bold read once; licensee and client lines, each with the (date) above", () => {
  // Fake bold: each letter drawn twice, a hair apart. Read as words, not "Signatuure".
  const bold = (str, x, y, size = 8) => {
    const xs = []; let s = "";
    [...str].forEach((ch, i) => { s += ch; xs.push(x + i * size * 0.5); if (ch !== " ") { s += ch; xs.push(x + i * size * 0.5 + 0.15); } });
    return { str: s, x, y, w: str.length * size * 0.5, size, xs };
  };
  assert.equal(toLines([bold("Signature of Licensee", 319, 118)])[0].text, "Signature of Licensee");
  assert.equal(toLines([word("Seller will", 40, 100)])[0].text, "Seller will"); // real double letters stay
  const p = page([
    word("________________ on ____________________.", 44, 143, 8), word("(place) (date)", 100, 135, 7),
    bold("Signature of Licensee", 319, 118), word("________________________________", 410, 118, 8),
    word("The undersigned acknowledges receipt of this Disclosure at ______________ on ______________.", 41, 92, 8),
    word("(place) (date)", 360, 83, 7),
    word("Signature of person/persons to whom disclosure has been made: ________________________", 41, 66, 8),
  ]);
  const f = autoLayout([p]).layout.fieldDefinitions.map((d) => `${d.type} ${d.signeeType} ${d.signeeIndex}`);
  assert.deepEqual(f, ["SIGNED_DATE AGENT 0", "SIGNATURE AGENT 0", "SIGNED_DATE CLIENT 0", "SIGNATURE CLIENT 0"]);
  // The real form's line is long: room for both clients side by side (one comes off with
  // a single client, forClients).
  const long = page([word(`Signature of person/persons to whom disclosure has been made: ${"_".repeat(70)}`, 41, 66, 8)]);
  const both = autoLayout([long]).layout.fieldDefinitions;
  assert.deepEqual(both.map((d) => `${d.signeeType} ${d.signeeIndex}`), ["CLIENT 0", "CLIENT 1"]);
  const [a, b] = both.map((d) => d.fieldLocations[0].position);
  assert.ok(a[2] < b[0] && a[1] === b[1], "side by side on the one line");
});

test("BCFSA disclosure of representation: each consumer initials and dates their line (optional on paper)", () => {
  const p = page([word("Initials (optional)", 63, 122, 7), word("Date", 180, 122, 7), word("Initials (optional)", 312, 122, 7), word("Date", 429, 122, 7)],
    [rule(63, 300, 131), rule(312, 549, 131)]);
  const f = autoLayout([p]).layout.fieldDefinitions;
  assert.deepEqual(f.map((d) => `${d.type} ${d.signeeType} ${d.signeeIndex} x${d.fieldLocations[0].position[0]}`),
    ["INITIALS CLIENT 0 x63", "SIGNED_DATE CLIENT 0 x180", "INITIALS CLIENT 1 x312", "SIGNED_DATE CLIENT 1 x429"]);
});

test("BC purchase contract footer: BUYER'S and SELLER'S INITIALS, each under its own cells (or a picture of them)", () => {
  const cells = (x) => [box(x, 83, x + 39, 110), box(x + 39, 83, x + 78, 110), box(x + 78, 83, x + 118, 110)];
  const label = [word("BUYER’S INITIALS", 45, 72, 10), word("SELLER’S INITIALS", 484, 72, 10)];
  const f = autoLayout([page(label, [...cells(27), ...cells(467)])]).layout.fieldDefinitions;
  assert.deepEqual(f.map((d) => `${d.signeeType} ${d.signeeIndex} x${d.fieldLocations[0].position[0]}`),
    ["BUYER 0 x28", "BUYER 1 x67", "BUYER 2 x106", "SELLER 0 x468", "SELLER 1 x507", "SELLER 2 x546"]);
  // Subject Removal draws each row of boxes as one picture: three cells centred on the label.
  const pic = { image: true, x1: 31, y1: 84, x2: 149, y2: 135 };
  const g = autoLayout([page([word("BUYER’S INITIALS", 47, 75, 11)], [pic])]).layout.fieldDefinitions;
  assert.equal(g.length, 3);
  const xs = g.map((d) => d.fieldLocations[0].position);
  assert.ok(xs.every((p) => p[0] >= 31 && p[2] <= 149 && p[1] >= 84 && p[3] <= 135), JSON.stringify(xs));
});

test("AREA Notice: Buyer/Seller Signature is the agent's own client, not the seller", () => {
  const p = page([word("Signed and dated at ________. m. on __________________________________, 20_______.", 40, 323, 9),
    word("Buyer/Seller Signature", 40, 289, 8), word("Witness Signature", 230, 289, 8)], [rule(38, 210, 300), rule(228, 390, 300)]);
  const { layout } = autoLayout([p]);
  assert.deepEqual(layout.fieldDefinitions.filter((d) => d.type === "SIGNATURE").map((d) => `${d.signeeType} ${d.signeeIndex}`), ["CLIENT 0"]);
  // A buyer's agent: the buyer signs it.
  assert.deepEqual(forClients(layout, { BUYER: 1 }).fieldDefinitions.filter((d) => d.type === "SIGNATURE").map((d) => d.signeeType), ["BUYER"]);
});

test("BC Subject Removal: three buyer and three seller lines drawn as one picture above B. APPOINTMENT OF CONVEYANCER", () => {
  const pic = { image: true, x1: 35, y1: 198, x2: 574, y2: 358 };
  const f = autoLayout([page([word("B. APPOINTMENT OF CONVEYANCER", 44, 156, 11.5)], [pic])]).layout.fieldDefinitions;
  assert.deepEqual(f.map((d) => `${d.type} ${d.signeeType} ${d.signeeIndex}`), [
    "SIGNATURE BUYER 0", "SIGNATURE BUYER 1", "SIGNATURE BUYER 2", "SIGNATURE SELLER 0", "SIGNATURE SELLER 1", "SIGNATURE SELLER 2"]);
  // Each on its own line, in its own third, left of the SEAL badge. The buyers' boxes reach
  // a little above the picture, into the blank under "Continued on Page 2".
  for (const [n, d] of f.entries()) {
    const [x1, y1, x2, y2] = d.fieldLocations[0].position;
    const third = 35 + (n % 3) * 539 / 3;
    assert.ok(x1 >= third && x2 <= third + 539 * 0.3 && y1 >= 198 && y2 <= 358 + 5, JSON.stringify(d.fieldLocations[0].position));
  }
  // The heading with no picture above it, or a small one: nothing.
  assert.equal(autoLayout([page([word("B. APPOINTMENT OF CONVEYANCER", 44, 156, 11.5)], [])]).layout, null);
  assert.equal(autoLayout([page([word("B. APPOINTMENT OF CONVEYANCER", 44, 156, 11.5)], [{ ...pic, x2: 200 }])]).layout, null);
});

test("BC multiple offers: (Seller's signature) and (Designated Agent's signature) under lines; signed this___Day of", () => {
  const p = page([
    word("Confirmed and signed this___Day of ___________________ Year ________.", 72, 212, 11),
    word("(Seller's signature)", 72, 159), word("(Listing Brokerage Name)", 329, 159),
    word("(Seller's signature)", 72, 111), word("(Designated Agent's signature)", 329, 111),
  ], [rule(71, 281, 176), rule(319, 541, 176), rule(71, 281, 128), rule(319, 541, 128)]);
  const f = autoLayout([p]).layout.fieldDefinitions.map((d) => `${d.type} ${d.signeeType} ${d.signeeIndex}`);
  assert.deepEqual(f, ["SIGNED_DATE SELLER 0", "SIGNATURE SELLER 0", "SIGNATURE SELLER 1", "SIGNATURE AGENT 0"]);
});

test("MREA Listing Contract: lower-case labels alone under their lines, and nothing from off the page", async () => {
  const [page] = await readPdfText(makePdf([
    "0 0 0 RG 33 154 m 273 154 l S 33 122 m 273 122 l S 33 90 m 273 90 l S 33 58 m 273 58 l S",
    "BT /F1 6 Tf 33 147 Td (Seller's signature) Tj ET",
    "BT /F1 6 Tf 33 115 Td (Seller's signature) Tj ET",
    "BT /F1 6 Tf 33 83 Td (Witness to Seller's signature) Tj ET",
    "BT /F1 6 Tf 33 51 Td (Listing Brokerage's representative) Tj ET",
    // In a sentence, under a line, it's only words.
    "300 220 m 560 220 l S BT /F1 6 Tf 300 213 Td (signed by the Seller's signature date) Tj ET",
    // The other half of a two-page spread, drawn 600pt to the right of the page.
    "656 154 m 896 154 l S BT /F1 6 Tf 656 147 Td (Seller's signature) Tj ET",
  ].join("\n")));
  assert.ok(page.items.every((i) => i.x < 612) && page.shapes.every((s) => s.x1 < 612), "off-page text and lines are dropped");
  const sigs = pageBlocks(page).filter((b) => b.spec.type === "SIGNATURE").map((b) => [b.role, b.x, b.y]);
  assert.deepEqual(sigs, [["SELLER", 35, 155], ["SELLER", 35, 123], ["AGENT", 35, 59]]);
});

test("MREA Listing Contract: the date beside Seller 1's line is Seller 1's", async () => {
  const [page] = await readPdfText(makePdf([
    "0 0 0 RG 33 154 m 273 154 l S 33 122 m 273 122 l S",
    "BT /F1 6 Tf 33 147 Td (Seller's signature) Tj ET",
    "BT /F1 6 Tf 33 115 Td (Seller's signature) Tj ET",
    "BT /F1 7 Tf 320 152 Td (SIGNED THIS ______________DAY OF _____________, 20____) Tj ET",
  ].join("\n")));
  const date = assignSlots(pageBlocks(page)).find((b) => b.date);
  assert.deepEqual([date.role, date.index], ["SELLER", 0]);
});

test("a form drawn a letter at a time still reads as words for its report", () => {
  const letters = (s, y) => [...s].map((ch, i) => ({ str: ch, x: 72 + i * 6, y, w: 6, size: 10, xs: [72 + i * 6] }));
  const pages = [{ items: [...letters("the price and the date of the sale to the buyer", 700), ...letters("Something unlabelled", 680)], shapes: [] }];
  assert.equal(placeOutcome({ pages, blocks: 0 }), "no-labels");
});

// Lease forms (AREA's commercial ones, 2026-10-31): Tenant and Landlord are buyer and seller.
const lines = (p) => toLines(p.items).map((l) => l.text);
const labels = (layout) => layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType}${f.signeeIndex + 1}`);

test("a lease: TENANT and LANDLORD headings name the side of the signing-officer lines under them", () => {
  const p = page([
    word("The tenant offers to lease the Premises to the landlord.", 38, 700),
    word("TENANT (CORPORATE NAME)", 38, 600, 10),
    word("Per:", 38, 560), word("Authorized Signing Officer", 54, 550), word("Witness", 324, 550),
    word("Per:", 38, 500), word("Authorized Signing Officer", 54, 490), word("Witness", 324, 490),
    word("LANDLORD (CORPORATE NAME)", 38, 400, 10),
    word("Per:", 38, 360), word("Authorized Signing Officer", 54, 350), word("Witness", 324, 350),
  ], [rule(54, 300, 560), rule(54, 300, 500), rule(54, 300, 360), rule(324, 570, 560)]);
  assert.equal(isLease([p]), true);
  const { layout } = autoLayout([p]);
  assert.deepEqual(labels(layout), ["SIGNATURE BUYER1", "SIGNATURE BUYER2", "SIGNATURE SELLER1"]);
  // the witness line beside each gets nothing
  assert.equal(layout.fieldDefinitions.every((f) => f.fieldLocations[0].position[0] < 300), true);
});

test("a lease's Landlord/Tenant rows are the agent's client; a 'circle one' note isn't a signing line", () => {
  const p = page([
    word("Notice to:", 38, 700), word("Landlord/Tenant (circle appropriate party)", 300, 688, 6),
    word("Landlord/Tenant", 38, 590), word("Witness", 330, 590),
    word("Landlord/Tenant", 38, 560), word("Witness", 330, 560),
  ], [rule(100, 560, 700), rule(38, 300, 600), rule(38, 300, 570), rule(330, 570, 600)]);
  const { layout } = autoLayout([p]);
  assert.deepEqual(labels(layout), ["SIGNATURE CLIENT1", "SIGNATURE CLIENT2"]);
  assert.deepEqual(labels(forClients(layout, { BUYER: 1, SELLER: 0 })), ["SIGNATURE BUYER1"]);
});

test("a lease's own label decides even when the form says 'you' more than 'tenant'", () => {
  const p = page([
    word("You authorize us to ask the landlord's brokerage, and the landlord, for details.", 38, 700),
    word("Signature of Tenant/Authorized Signing Officer", 38, 590),
  ], [rule(38, 300, 600)]);
  assert.equal(isLease([p]), true);
  assert.deepEqual(labels(autoLayout([p]).layout), ["SIGNATURE BUYER1"]);
});

test("a purchase contract that mentions tenants stays a purchase contract", () => {
  const p = page([
    word("The seller will deliver the property free of tenants, and the tenant's lease ends before the buyer takes possession.", 38, 700, 7),
    word("Buyer Signature", 38, 590), word("Seller Signature", 330, 590),
  ], [rule(38, 300, 600), rule(330, 570, 600)]);
  assert.equal(isLease([p]), false);
  assert.deepEqual(labels(autoLayout([p]).layout), ["SIGNATURE BUYER1", "SIGNATURE SELLER1"]);
  assert.deepEqual(lines(p)[0].includes("tenant"), true);
});

test("the commercial Agency Relationships guide: 'Your signature' and its Date on one row", () => {
  const p = page([word("Your signature", 46, 424), word("Date", 369, 424)],
    [rule(46, 300, 439), rule(365, 560, 439)]);
  assert.deepEqual(labels(autoLayout([p]).layout), ["SIGNATURE CLIENT1", "SIGNED_DATE CLIENT1"]);
});

test("a time blank of its own however the date line is worded: 'and DATED at ____ ___. m. on'", () => {
  const p = page([
    word("SIGNED in the presence of a witness, and DATED at ________ ___. m. on ______________________, 20_____.", 38, 620),
    word("Landlord/Tenant", 38, 590), word("Witness", 330, 590),
  ], [rule(38, 300, 600), rule(330, 570, 600)]);
  assert.deepEqual(labels(autoLayout([p]).layout), ["SIGNED_TIME_ONLY CLIENT1", "SIGNED_DATE_ONLY CLIENT1", "SIGNATURE CLIENT1"]);
  // no time blank: one Date & Time block, as before
  const q = page([word("SIGNED AND DATED on ______________________, 20_____.", 38, 620), word("Buyer Signature", 38, 590)], [rule(38, 300, 600)]);
  assert.deepEqual(labels(autoLayout([q]).layout), ["SIGNED_DATE BUYER1", "SIGNATURE BUYER1"]);
});

test("nothing in a purchase contract's REJECTION section: signing there declines the offer", () => {
  // AREA's Commercial Purchase Contract, last page (Dan, 2026-10-31): the acceptance gets
  // the seller; the rejection under "has no effect on the contract's terms" gets nothing.
  const p = page([
    word("SIGNED AND DATED at ________ ___. m. on ______________________, 20_____.", 38, 700),
    word("Signature of Seller or Authorized Signatory of Seller", 38, 660), word("Signature of Witness", 330, 660),
    word("INFORMATION", 38, 560, 10),
    word("The following is for information purposes and has no effect on the contract's terms:", 38, 548),
    word("REJECTION", 38, 530, 10),
    word("I/we do not accept this offer/counteroffer. No counteroffer is being made.", 38, 515),
    word("SIGNED AND DATED at ________ ___. m. on ______________________, 20_____.", 38, 495),
    word("Signature of Seller or Authorized Signatory of Seller", 38, 470), word("Signature of Buyer or Authorized Signatory of Buyer", 330, 470),
    // a company's name typed in capitals between the two lines is not a heading
    word("EXAMPLE HOLDINGS LTD.", 38, 452),
    word("Signature of Seller or Authorized Signatory of Seller", 38, 440), word("Signature of Buyer or Authorized Signatory of Buyer", 330, 440),
    word("CONVEYANCING INFORMATION", 38, 400, 10),
  ], [rule(38, 300, 670), rule(330, 570, 670), rule(38, 300, 480), rule(330, 570, 480), rule(38, 300, 450), rule(330, 570, 450)]);
  const f = autoLayout([p]).layout.fieldDefinitions;
  assert.equal(f.every((d) => d.fieldLocations[0].position[1] > 600), true, "nothing below the INFORMATION heading");
  assert.ok(f.some((d) => d.type === "SIGNATURE"), "the acceptance still gets its signature");
});

test("lines left for the agent: counted and said plainly", () => {
  const layout = { fieldDefinitions: [{ type: "SIGNATURE", signeeType: "CLIENT" }, { type: "SIGNATURE", signeeType: "CLIENT" },
    { type: "SIGNED_DATE", signeeType: "CLIENT" }, { type: "SIGNATURE", signeeType: "AGENT" }] };
  assert.equal(clientsLeft(layout, { BUYER: 1, SELLER: 0 }), 0, "one side signing: they're that side's");
  assert.equal(clientsLeft(layout, { BUYER: 2, SELLER: 1 }), 2);
  assert.equal(leftNote({ customer: 0, clients: 0 }), "");
  assert.equal(leftNote({ customer: 2 }), "2 customer signature lines weren't placed: the form doesn't say which side the customer is on. Place them in Real Signature.");
  assert.equal(leftNote({ clients: 1 }), "1 client signature line wasn't placed: both sides are signing, and the form doesn't say whose it is. Place it in Real Signature.");
});

test("SREC Form 910: Witness beside a possessive label, lines to its right, and a Dated at … day of date", () => {
  const p = page([
    word("Dated at ________________ this ______ day of _____________________, 20___", 36, 107, 9),
    word("Witness                                   Buyer's Signature", 36, 85, 10),
    word("Witness                                   Buyer's Signature", 36, 67, 10),
  ], [rule(72, 240, 81.3), rule(333, 520, 81.3), rule(72, 240, 62.6), rule(333, 520, 62.6)]); // label ends at x331
  const got = autoLayout([p]).layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType}${f.signeeIndex + 1} x${f.fieldLocations[0].position[0]}`);
  // One Date block (the "at" is a place, not a time), and each buyer on the line right of the label.
  assert.deepEqual(got.map((g) => g.replace(/ x[\d.]+$/, "")), ["SIGNED_DATE BUYER1", "SIGNATURE BUYER1", "SIGNATURE BUYER2"]);
  assert.ok(got.slice(1).every((g) => / x335(\.\d+)?$/.test(g)), got.join());
});

test("CREA's bare 'Signed:' lines: whose they are comes from the title, and the Date under it is theirs", () => {
  const form = (title, rows) => [page([word(title, 36, 740, 14), ...rows.map(([t, y]) => word(t, 36, y, 10))], [])];
  const seller = form("REALTOR® Cooperation Disclosure and Consent Form",
    [["Signed: ______________________________", 197], ["Name:  ______________________________", 168], ["Date:  ______________________________", 139]]);
  const dots = ". ".repeat(30);
  const buyer = form("Certificate and Consent of Purchaser - Individual",
    [[`SIGNED:   ${dots}`, 360], [`NAME: ${dots}`, 342], [`DATE:   ${dots}`, 324]]);
  const kinds = (pages) => autoLayout(pages).layout.fieldDefinitions.map((f) => `${f.type} ${f.signeeType}${f.signeeIndex + 1}`);
  assert.deepEqual(kinds(seller), ["SIGNATURE SELLER1", "SIGNED_DATE SELLER1"]);
  assert.deepEqual(kinds(buyer), ["SIGNATURE BUYER1", "SIGNED_DATE BUYER1"]);
  // Any other form's bare "Signed:" is nobody's: nothing is guessed.
  assert.equal(autoLayout(form("SOME OTHER FORM", [["Signed: ______________________________", 197]])).layout, null);
});

test("placedSummary counts the lines each side gets, as slots", async () => {
  const { placedSummary } = await import("../src/lib/autoplace.js");
  const def = (signeeType, signeeIndex) => ({ signeeType, signeeIndex });
  const s = placedSummary({ fieldDefinitions: [def("SELLER", 0), def("SELLER", 1), def("CLIENT", 0), def("SELLERS_AGENT", 0)] });
  assert.deepEqual(s.slots, { BUYER: 0, SELLER: 2, CLIENT: 1 });
  assert.equal(s.agent, true);
  assert.deepEqual(placedSummary(null).slots, { BUYER: 0, SELLER: 0, CLIENT: 0 });
});

test("a company client signs on the Per lines, and its Seller/Buyer lines stay blank", () => {
  // AREA's Commercial Purchase Contract notices: two Seller/Buyer lines, then two Per lines
  // with no party heading over them (Dan, 2026-11-03).
  const p = page([
    word("SIGNED in the presence of a witness, and DATED at ________. m. on ____________________, 20___.", 36, 273),
    word("Seller/Buyer", 36, 228), word("Witness", 315, 228),
    word("Seller/Buyer", 36, 201), word("Witness", 315, 201),
    word("Per:", 36, 141), word("Authorized Signing Officer(s)", 54, 131), word("Witness", 324, 131),
    word("Per:", 36, 113), word("Authorized Signing Officer(s)", 54, 103), word("Witness", 324, 103),
  ], [rule(36, 190, 237), rule(36, 190, 210), rule(54, 200, 140), rule(54, 200, 112), rule(315, 500, 237)]);
  const sigs = (layout) => layout.fieldDefinitions.filter((f) => f.type === "SIGNATURE")
    .map((f) => [`${f.signeeType}${f.signeeIndex + 1}`, f.fieldLocations[0].position[1]]);
  // A person, or No deal: the Seller/Buyer lines, as before; the unheaded Per lines get nothing.
  assert.deepEqual(sigs(autoLayout([p]).layout), [["CLIENT1", 238], ["CLIENT2", 211]]);
  // A company: its officers on the Per lines, nothing on Seller/Buyer, and the date stays.
  const { layout } = autoLayout([p], { company: true });
  assert.deepEqual(sigs(layout), [["CLIENT1", 141], ["CLIENT2", 113]]);
  assert.equal(layout.fieldDefinitions.filter((f) => f.type === "SIGNED_DATE_ONLY").length, 1);
  assert.deepEqual(labels(forClients(layout, { BUYER: 0, SELLER: 1 })).filter((l) => l.startsWith("SIGNATURE")), ["SIGNATURE SELLER1"]);
});

test("a company on a form without Per lines still signs its Seller/Buyer line", () => {
  const p = page([word("Seller/Buyer", 36, 228), word("Witness", 315, 228)], [rule(36, 190, 237)]);
  assert.deepEqual(labels(autoLayout([p], { company: true }).layout), ["SIGNATURE CLIENT1"]);
});

test("a company on a lease: Per lines under a party heading stay that party's", () => {
  const p = page([
    word("The tenant offers to lease the Premises to the landlord.", 38, 700),
    word("Landlord/Tenant", 38, 640), word("Witness", 330, 640),
    word("TENANT (CORPORATE NAME)", 38, 600, 10),
    word("Per:", 38, 560), word("Authorized Signing Officer", 54, 550), word("Witness", 324, 550),
  ], [rule(38, 300, 650), rule(54, 300, 560)]);
  assert.deepEqual(labels(autoLayout([p]).layout), ["SIGNATURE CLIENT1", "SIGNATURE BUYER1"]);
  assert.deepEqual(labels(autoLayout([p], { company: true }).layout), ["SIGNATURE BUYER1"]);
});

test("a company whose Per lines have no line drawn above them signs the Seller/Buyer line", () => {
  const p = page([
    word("Seller/Buyer", 36, 228), word("Witness", 315, 228),
    word("Per:", 36, 141), word("Authorized Signing Officer(s)", 54, 131),
  ], [rule(36, 190, 237)]);
  assert.deepEqual(labels(autoLayout([p], { company: true }).layout), ["SIGNATURE CLIENT1"]);
});
