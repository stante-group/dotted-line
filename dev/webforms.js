// TEST COPY ONLY: the test WEBForms page (see sim-hooks.js).

import { allForms, putForm, deleteForm, getDeal, setDeal, addSimTab } from "./sim-hooks.js";
import { readPdfText } from "../src/lib/pdftext.js";
import { isPdf, countPages } from "../src/lib/pdf.js";

const $ = (id) => document.getElementById(id);
const DEAL_FIELDS = ["address", "city", "mls", "name", "side", "buyers", "sellers", "userName", "userEmail"];
const CODE = /^[A-Z]{2,8}[0-9]{1,6}[A-Z]{0,2}$/; // report.js's pattern for a form code

// The icon works on this tab as it does on WEBForms: a popup, started from here.
const tab = await chrome.tabs.getCurrent();
await addSimTab(tab.id);
await chrome.action.enable(tab.id).catch(() => {});
await chrome.action.setPopup({ tabId: tab.id, popup: "src/panel/panel.html?popup=1" }).catch(() => {});

// An open panel re-reads the picks when told something changed, as with WEBForms' clicks.
const changed = () => chrome.runtime.sendMessage({ type: "webforms:changed" }).catch(() => {});

const deal = await getDeal();
for (const k of DEAL_FIELDS) {
  $(k).value = deal[k];
  $(k).addEventListener("input", async () => {
    await setDeal(Object.fromEntries(DEAL_FIELDS.map((f) => [f, $(f).value])));
    changed();
  });
}

async function draw() {
  const forms = await allForms();
  $("empty").hidden = forms.length > 0;
  $("forms").replaceChildren(...forms.map((f) => {
    const tr = document.createElement("tr");
    const cell = (cls) => { const td = document.createElement("td"); if (cls) td.className = cls; tr.append(td); return td; };

    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = !!f.ticked;
    tick.addEventListener("change", async () => { await putForm({ ...f, ticked: tick.checked }); f.ticked = tick.checked; changed(); });
    cell().append(tick);

    const name = document.createElement("input");
    name.type = "text";
    name.value = f.name;
    name.addEventListener("change", async () => {
      f.name = name.value.trim() || f.name;
      name.value = f.name;
      await putForm(f);
      changed();
    });
    cell().append(name);

    const code = document.createElement("input");
    code.type = "text";
    code.value = f.library || "";
    code.placeholder = "e.g. AREA0287";
    code.addEventListener("input", async () => {
      const v = code.value.trim().toUpperCase();
      code.classList.toggle("bad", !!v && !CODE.test(v));
      if (v && !CODE.test(v)) return;
      f.library = v || null;
      await putForm(f);
      changed();
    });
    cell("code").append(code);

    cell("pages").textContent = f.pages ?? "?";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => { await deleteForm(f.id); await draw(); changed(); });
    cell().append(remove);
    return tr;
  }));
}

$("add").addEventListener("change", async () => {
  $("msg").hidden = true;
  const files = [...$("add").files];
  let order = Math.max(0, ...(await allForms()).map((f) => f.order)) + 1;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPdf(bytes)) { alertRow(`"${file.name}" isn't a PDF.`); continue; }
    // WEBForms says how many pages; here the PDF is read for it, as Auto place will.
    const pages = await readPdfText(bytes).then((p) => p.length, () => countPages(bytes));
    await putForm({ id: crypto.randomUUID(), name: file.name.replace(/\.pdf$/i, ""), library: null, ticked: true, pages, bytes: bytes.buffer, order: order++ });
  }
  $("add").value = "";
  await draw();
  changed();
});

$("clear").addEventListener("click", async () => {
  for (const f of await allForms()) await deleteForm(f.id);
  await draw();
  changed();
});

// A message under the table, not a browser dialog.
function alertRow(text) {
  $("msg").hidden = false;
  $("msg").textContent = text;
}

await draw();
