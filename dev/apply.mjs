// TEST COPY ONLY. Wires the test WEBForms page (dev/) into a COPY of the extension:
//
//   node dev/apply.mjs <test copy folder> "<label>"
//
// run on a fresh copy of the repo (the copy has dev/ in it already). It edits the copy's
// panel, worker and Settings page, and sets its version_name to the label. The repo's own
// src/ is never touched, so the store zip (manifest + src + icons) can't carry any of this;
// test/dev-guard.test.js fails if src/ or the manifest ever mention dev/.
//
// Each edit must find its text exactly once. If the panel or worker changed so one doesn't,
// this stops and changes nothing, rather than half-wiring a test copy.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [dir, label] = process.argv.slice(2);
if (!dir || !label) { console.error('usage: node dev/apply.mjs <test copy folder> "<label>"'); process.exit(2); }
if (!existsSync(join(dir, "dev", "sim-hooks.js"))) { console.error(`${dir} has no dev/sim-hooks.js: copy the repo there first`); process.exit(2); }

const MARK = "DEV-SIM";
const edits = {
  "src/panel/panel.js": [
    [`import { sendToTab } from "../messaging.js";\n`,
     `import { sendToTab } from "../messaging.js";\nimport * as sim from "../../dev/sim-hooks.js"; // ${MARK}: test copy only\n`],
    [`const send = sendToTab;\n`,
     `const send = sim.wrapSend(sendToTab); // ${MARK}\n`],
    [`async function selection(tabId) {\n`,
     `async function selection(tabId) {\n  if (await sim.isSimTab(tabId)) return sim.selection(); // ${MARK}\n`],
    [`      if (tab?.url?.startsWith(WF)) {\n`,
     `      if (tab?.url?.startsWith(WF) || await sim.isSimTab(tab?.id)) { // ${MARK}\n`],
  ],
  "src/background.js": [
    [`import { sendToTab } from "./messaging.js";\n`,
     `import { sendToTab as realSendToTab } from "./messaging.js";\nimport { wrapSend, isSimTab } from "../dev/sim-hooks.js"; // ${MARK}: test copy only\nconst sendToTab = wrapSend(realSendToTab);\n`],
    [`await (rs || u.startsWith(WF) ? chrome.action.enable(tabId)`,
     `await (rs || u.startsWith(WF) || await isSimTab(tabId) /* ${MARK} */ ? chrome.action.enable(tabId)`],
  ],
  "src/options/options.html": [
    [`  <h2>Check my setup</h2>`,
     `  <h2>Test WEBForms</h2>\n  <p><a href="../../dev/webforms.html" target="_blank">Open the test WEBForms page</a>: try any PDF as if it came from WEBForms. Test copies only. <!-- ${MARK} --></p>\n\n  <h2>Check my setup</h2>`],
  ],
};

// All checked before anything is written.
const out = {};
for (const [file, pairs] of Object.entries(edits)) {
  let s = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
  if (s.includes(MARK)) { console.error(`${file} is already patched: copy the repo there again first`); process.exit(1); }
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) { console.error(`${file}: expected 1 of ${JSON.stringify(a.slice(0, 60))}, found ${n}. Update dev/apply.mjs.`); process.exit(1); }
    s = s.replace(a, b);
  }
  out[file] = s;
}
const mf = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
mf.version_name = label;
out["manifest.json"] = JSON.stringify(mf, null, 2) + "\n";

for (const [file, s] of Object.entries(out)) writeFileSync(join(dir, file), s);
console.log(`test copy wired: ${Object.keys(edits).join(", ")}; version_name "${label}"`);
