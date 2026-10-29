// Reading where a PDF's words are, and placing blocks from a form's printed labels.
// Invented forms only: the PDFs are built here, never copied from a real form.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

import { readPdfText, md5, rc4 } from "../src/lib/pdftext.js";
import { pageBlocks, autoLayout, forAgent, forClients, withSigners, toLines } from "../src/lib/autoplace.js";

const enc = (s) => new TextEncoder().encode(s);
const latin = (u8) => new TextDecoder("latin1").decode(u8);

/** A one-page Helvetica PDF from a content stream; optionally Flate and RC4-locked the way
 *  WEBForms locks its PDFs (Standard handler, R3, 128-bit, empty user password). */
function makePdf(content, { flate = false, lock = false } = {}) {
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
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
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
