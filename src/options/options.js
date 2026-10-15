// Settings page. Everything saves as it changes (no Save button to forget) into
// chrome.storage.sync under "settings"; the panel reads it with the same defaults.

import { WORDS, DEFAULT_SETTINGS, SAMPLE_VALUES, fillPattern } from "../lib/pattern.js";
import { pruneRemembered } from "../lib/match.js";
import { runSetupCheck } from "../setup-check.js";

const $ = (id) => document.getElementById(id);
let current = { ...DEFAULT_SETTINGS };

async function load() {
  try {
    const { settings } = await chrome.storage.sync.get("settings");
    current = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  } catch { /* defaults */ }
}

let savedTimer;
async function save() {
  try {
    await chrome.storage.sync.set({ settings: current });
    $("saved").textContent = "Saved";
  } catch (e) {
    $("saved").textContent = `Couldn't save: ${String(e?.message || e).slice(0, 80)}`;
  }
  $("saved").classList.add("on");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $("saved").classList.remove("on"), 1400);
}

// Typing saves after a short pause rather than on every key (sync storage limits writes).
let typingTimer;
const saveSoon = () => { clearTimeout(typingTimer); typingTimer = setTimeout(save, 500); };
// Closing the tab inside that pause would drop the last keystrokes, so flush when it hides.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && typingTimer) { clearTimeout(typingTimer); typingTimer = null; save(); }
});

function unknownWords(pattern, allowTitle) {
  const known = new Set(WORDS.map(([w]) => w).filter((w) => allowTitle || w !== "title"));
  return [...String(pattern).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((w) => !known.has(w.toLowerCase()));
}

function preview(kind) {
  const box = $(`${kind}Preview`);
  const pattern = current[`${kind}Pattern`];
  const values = kind === "subject" ? { ...SAMPLE_VALUES, title: sampleTitle() } : SAMPLE_VALUES;
  const text = fillPattern(pattern, values);
  const bad = unknownWords(pattern, kind === "subject");
  box.replaceChildren();
  const line = document.createElement("div");
  line.append("Preview: ");
  const b = document.createElement("b");
  b.textContent = text || "(empty — the suggested title is used instead)";
  line.append(b);
  box.append(line);
  if (bad.length) {
    const w = document.createElement("div");
    w.className = "warn";
    w.textContent = `Not a word Dotted Line knows: ${bad.map((x) => `{${x}}`).join(", ")}`;
    box.append(w);
  }
}

// What {title} would be in the subject preview, given the title setting.
function sampleTitle() {
  if (current.titleMode === "pattern") return fillPattern(current.titlePattern, SAMPLE_VALUES);
  if (current.titleMode === "blank") return "Offer – 1234-120 Example Street NW";
  return `${SAMPLE_VALUES.forms} – ${SAMPLE_VALUES.address}`;
}

function wordButtons(kind) {
  const box = $(`${kind}Words`);
  const input = $(`${kind}Pattern`);
  for (const [w, about] of WORDS) {
    if (w === "title" && kind !== "subject") continue;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `{${w}}`;
    b.title = about;
    b.addEventListener("click", () => {
      // Insert at the cursor, with a space if it would otherwise run into the text before.
      const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
      const before = input.value.slice(0, s), after = input.value.slice(e);
      const ins = (before && !/\s$/.test(before) ? " " : "") + `{${w}}`;
      input.value = before + ins + after;
      input.focus();
      input.setSelectionRange(s + ins.length, s + ins.length);
      input.dispatchEvent(new Event("input"));
    });
    box.append(b);
  }
}

function render() {
  for (const r of document.querySelectorAll("input[name=autoCreate]")) r.checked = (r.value === "on") === current.autoCreate;
  $("startOnOpen").checked = current.startOnOpen;
  for (const kind of ["title", "subject"]) {
    const mode = current[`${kind}Mode`];
    for (const r of document.querySelectorAll(`input[name=${kind}Mode]`)) r.checked = r.value === mode;
    $(`${kind}PatternWrap`).hidden = mode !== "pattern";
    if ($(`${kind}Pattern`) !== document.activeElement) $(`${kind}Pattern`).value = current[`${kind}Pattern`];
    preview(kind);
  }
}

// ---- remembered templates (chrome.storage.local "templateFor", written by the panel) ----

async function readRemembered() {
  try {
    return pruneRemembered((await chrome.storage.local.get("templateFor")).templateFor);
  } catch {
    return {};
  }
}

function rememberedRow(key, entry) {
  // Entries saved before 2026-10-13 are a bare template id under "name:<form name>".
  // Their only name is the lowercased key, so give it a capital back.
  const old = typeof entry === "string";
  // Since 2026-10-14 a choice can be for one side: "lib:AREA0287|BUYER" (match.js rememberKey).
  const [base, side] = key.split("|");
  const fromKey = base.replace(/^(name|lib):/, "").replace(/^./, (c) => c.toUpperCase());
  const forSide = side === "BUYER" ? " (buyer deals)" : side === "SELLER" ? " (seller deals)" : "";
  const form = (old ? fromKey : entry.form || fromKey) + forSide;
  const li = document.createElement("li");
  const what = document.createElement("div");
  what.className = "what";
  const f = document.createElement("div");
  f.className = "form";
  f.textContent = form;
  const t = document.createElement("div");
  t.className = "tpl";
  t.textContent = old ? "Template chosen before this list existed" : `→ ${entry.template || "a template"}`;
  what.append(f, t);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "remove";
  b.textContent = "Remove";
  b.setAttribute("aria-label", `Remove the remembered template for ${form}`);
  b.addEventListener("click", async () => {
    const all = await readRemembered();
    delete all[key];
    await chrome.storage.local.set({ templateFor: all });
    await renderRemembered();
    flash("Removed");
  });
  li.append(what, b);
  return [form, li];
}

async function renderRemembered() {
  const box = $("remembered");
  const all = await readRemembered();
  const rows = Object.entries(all).map(([k, v]) => rememberedRow(k, v))
    .sort(([a], [b]) => a.localeCompare(b)).map(([, li]) => li);
  if (!rows.length) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = "None yet. They appear here after you create a draft with a template.";
    box.replaceChildren(p);
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "remembered";
  ul.append(...rows);
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "link";
  clear.textContent = rows.length > 1 ? `Remove all ${rows.length}` : "Remove it";
  clear.addEventListener("click", async () => {
    await chrome.storage.local.set({ templateFor: {} });
    await renderRemembered();
    flash("Removed");
  });
  box.replaceChildren(ul, ...(rows.length > 1 ? [clear] : []));
}

function flash(text) {
  $("saved").textContent = text;
  $("saved").classList.add("on");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $("saved").classList.remove("on"), 1400);
}

// A draft created in another tab while this page is open shows up without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.templateFor) renderRemembered();
});

await load();
await renderRemembered();
for (const r of document.querySelectorAll("input[name=autoCreate]")) {
  r.addEventListener("change", () => { current.autoCreate = r.value === "on"; render(); save(); });
}
$("startOnOpen").addEventListener("change", (e) => { current.startOnOpen = e.target.checked; save(); });
for (const kind of ["title", "subject"]) {
  wordButtons(kind);
  for (const r of document.querySelectorAll(`input[name=${kind}Mode]`)) {
    r.addEventListener("change", () => { current[`${kind}Mode`] = r.value; render(); save(); });
  }
  $(`${kind}Pattern`).addEventListener("input", (e) => {
    current[`${kind}Pattern`] = e.target.value;
    render();
    saveSoon();
  });
}
render();

$("setup-run").addEventListener("click", async () => {
  $("setup-out").hidden = false;
  $("setup-out").textContent = "Checking…";
  try { $("setup-out").textContent = await runSetupCheck(); }
  catch (e) { $("setup-out").textContent = `Couldn't run the check: ${String(e?.message || e)}`; }
});
