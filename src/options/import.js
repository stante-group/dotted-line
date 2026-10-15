// Settings → Import templates (DocuSign template files). The export is read here (src/lib/docusign.js); the agent
// confirms who each DocuSign role is; the Real Signature tab makes the template
// (src/realsig/content.js importTemplate). Nothing leaves this browser but the PDF and the
// blocks, and only to the agent's own Real Signature account.

import { readDocusignTemplate, guessRoles, roleBlocks, leftOutText, buildTemplate } from "../lib/docusign.js";
import { unzip } from "../lib/unzip.js";
import { isPdf, countPages, toBase64 } from "../lib/pdf.js";
import { sendToTab } from "../messaging.js";

const RS = "https://signature.therealbrokerage.com/";
const OFFER_BLANK = false; // the "Blank form PDF" picker on each card (see card())
const $ = (id) => document.getElementById(id);

const SLOTS = [
  ...[1, 2, 3, 4].map((n) => [`BUYER#${n - 1}`, `Buyer ${n}`]),
  ...[1, 2, 3, 4].map((n) => [`SELLER#${n - 1}`, `Seller ${n}`]),
  ["BUYERS_AGENT#0", "Buyer's agent"],
  ["SELLERS_AGENT#0", "Seller's agent"],
];
const toSlot = (v) => (v ? { signeeType: v.split("#")[0], signeeIndex: Number(v.split("#")[1]) } : null);

/** The files chosen → [{file, parsed}] or [{file, error}]. A .zip is DocuSign's download of
 *  several templates: one .json each. */
async function readFiles(files) {
  const out = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let parts;
    try {
      parts = /\.zip$/i.test(f.name) ? (await unzip(bytes)).filter((e) => /\.json$/i.test(e.name)) : [{ name: f.name, data: bytes }];
      if (!parts.length) throw new Error("no template files inside this .zip");
    } catch (e) { out.push({ file: f.name, error: String(e?.message || e) }); continue; }
    for (const p of parts) {
      try { out.push({ file: p.name, parsed: readDocusignTemplate(new TextDecoder().decode(p.data)) }); }
      catch (e) { out.push({ file: p.name, error: String(e?.message || e) }); }
    }
  }
  return out;
}

/** Send to the most recently used Real Signature tab that's listening. A tab opened before
 *  the extension was (re)loaded can't answer, so try the next — but a real error from a
 *  tab that did answer stops there, so a template is never made twice. */
async function toRealSignature(msg) {
  const tabs = (await chrome.tabs.query({ url: `${RS}*` })).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  if (!tabs.length) throw new Error("Open Real Signature in a tab first (signed in), then try again.");
  for (const t of tabs) {
    try { return await sendToTab(t.id, msg); }
    catch (e) { if (!/Reload this tab once/.test(String(e?.message))) throw e; }
  }
  throw new Error("Reload your Real Signature tab once (the extension was updated after it opened), then try again.");
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** One card per document: a DocuSign template with two documents makes two templates, as
 *  Real Signature keeps one PDF per template. */
function card(parsed, doc) {
  const box = el("div", "ds");
  const roles = parsed.roles.map((r) => ({ r, ...roleBlocks(r, doc.id) }));
  const signing = roles.filter((x) => x.blocks.length);
  const total = signing.reduce((n, x) => n + x.blocks.length, 0);
  const title = parsed.documents.length > 1 ? `${parsed.name} – ${doc.name.replace(/\.pdf$/i, "")}` : parsed.name;
  box.append(el("div", "t", title));
  box.append(el("div", "sub", `${Number.isFinite(doc.pages) ? `${doc.pages} pages · ` : ""}${total} block${total === 1 ? "" : "s"}`));
  const left = {};
  for (const x of roles) for (const [k, v] of Object.entries(x.left)) left[k] = (left[k] || 0) + v;

  const guesses = guessRoles(signing.map((x) => x.r));
  const selects = [];
  for (const { r, blocks } of signing) {
    const row = el("label", "role");
    row.append(el("span", null, `${r.roleName} (${blocks.length} block${blocks.length === 1 ? "" : "s"})`));
    const s = el("select");
    s.dataset.key = r.key;
    const g = guesses[r.key];
    const unset = el("option", null, "Choose…");
    unset.value = "?";
    s.append(unset);
    for (const [v, label] of SLOTS) s.append(Object.assign(el("option", null, label), { value: v }));
    s.append(Object.assign(el("option", null, "Leave out"), { value: "" }));
    s.value = g ? `${g.signeeType}#${g.signeeIndex}` : "?";
    row.append(s);
    box.append(row);
    selects.push(s);
  }
  if (Object.keys(left).length) box.append(el("div", "sub", `Not brought over: ${leftOutText(left)}.`));

  // The PDF inside an export is often a used one: a form filled in for a past client, saved
  // as a template. A blank copy of the same form can stand in: the blocks go by page and
  // position, so only the page count has to match. Built but not offered (Dan, 2026-10-15):
  // that copy has already been sent through another signing tool, so keeping it in the
  // agent's own Real Signature account oversteps nothing; offer the picker when asked for.
  // Before offering it: it can't tell WHICH form a PDF is. Dan's test (2026-10-15) took a
  // different form with the same page count, and the blocks landed on the wrong lines; and
  // WEBForms' PDFs are encrypted, so even the page count usually can't be read here. It
  // needs a form check (WEBForms' form code from the file name or a picker of the agent's
  // WEBForms forms) or a preview of the blocks on the chosen PDF.
  let blank = null; // {name, base64}
  const blankRow = el("label", "role");
  blankRow.append(el("span", null, "Blank form PDF (recommended)"));
  const blankInput = el("input");
  blankInput.type = "file";
  blankInput.accept = ".pdf,application/pdf";
  blankRow.append(blankInput);
  const UNSET = "Otherwise the file's own copy is used, which may show a past client's details.";
  const blankNote = el("div", "sub", UNSET);
  if (OFFER_BLANK) box.append(blankRow, blankNote);
  blankInput.addEventListener("change", async () => {
    blank = null;
    blankNote.className = "sub";
    blankNote.textContent = UNSET;
    const f = blankInput.files[0];
    if (!f) { check(); return; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    // WEBForms' PDFs are permission-locked (encrypted), so this is usually null: the page
    // tree can't be read without the key (2026-10-15). Then the agent checks in Real.
    const n = countPages(bytes);
    if (!isPdf(bytes)) {
      blankNote.className = "out err";
      blankNote.textContent = `"${f.name}" isn't a PDF.`;
    } else if (n && Number.isFinite(doc.pages) && n !== doc.pages) {
      blankNote.className = "out err";
      blankNote.textContent = `"${f.name}" has ${n} pages; this template has ${doc.pages}. Choose the same form.`;
    } else {
      blank = { name: f.name, base64: toBase64(bytes) };
      blankNote.textContent = n ? `Using "${f.name}" (${n} pages).` : `Using "${f.name}". Make sure it's the same form, with the same pages.`;
    }
    check();
  });

  const go = el("button", "go", "Create in Real Signature");
  go.type = "button";
  const out = el("div", "out");
  const slots = () => Object.fromEntries(selects.map((s) => [s.dataset.key, toSlot(s.value)]));
  const check = () => {
    out.className = "out";
    out.textContent = "";
    if (selects.some((s) => s.value === "?")) { go.disabled = true; out.textContent = "Choose who each role is."; return null; }
    if (blankInput.files[0] && !blank) { go.disabled = true; return null; } // a refused blank isn't silently swapped for the file's copy
    if (!blank && !doc.base64) {
      go.disabled = true;
      out.className = "out err";
      out.textContent = OFFER_BLANK ? "The PDF isn't in this file — choose a blank form above." : "The PDF isn't in this file — download the template again.";
      return null;
    }
    try { const t = buildTemplate(parsed, doc.id, slots()); go.disabled = false; return t; }
    catch (e) { go.disabled = true; out.className = "out err"; out.textContent = String(e?.message || e); return null; }
  };
  for (const s of selects) s.addEventListener("change", check);
  if (!signing.length) { go.disabled = true; out.textContent = "No signature, initials or date blocks to bring over."; }
  else check();

  go.addEventListener("click", async () => {
    const template = check();
    if (!template) return;
    go.disabled = true;
    for (const s of selects) s.disabled = true;
    blankInput.disabled = true;
    out.className = "out";
    out.textContent = "Creating…";
    try {
      const r = await toRealSignature({ type: "rs:import-template", pdfBase64: blank?.base64 ?? doc.base64, template });
      out.replaceChildren("Created. ");
      const a = el("a", null, "Check it in Real Signature");
      a.href = new URL(r.url, RS).href;
      a.target = "_blank";
      a.rel = "noopener";
      out.append(a);
      go.textContent = "Created";
    } catch (e) {
      out.className = "out err";
      out.textContent = String(e?.message || e);
      go.disabled = false;
      for (const s of selects) s.disabled = false;
      blankInput.disabled = false;
    }
  });
  box.append(go, out);
  return box;
}

$("ds-file").addEventListener("change", async (e) => {
  const list = $("ds-list");
  list.replaceChildren(el("div", "sub", "Reading…"));
  const read = await readFiles([...e.target.files]);
  list.replaceChildren();
  for (const x of read) {
    if (x.error) {
      const b = el("div", "ds");
      b.append(el("div", "t", x.file), Object.assign(el("div", "out err", x.error)));
      list.append(b);
      continue;
    }
    for (const doc of x.parsed.documents) list.append(card(x.parsed, doc));
  }
});
