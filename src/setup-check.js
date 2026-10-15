// "Check my setup" (Phase 0 item 7 harness): counts and yes/no about both sign-ins, plus the
// last draft's step timings. Lives on the Settings page — it's for troubleshooting, and on the
// panel it sat next to "Settings" and read like the same thing (Dan, 2026-10-15).
import { askOpenTab as ask } from "./messaging.js";
import { setupReport, samePerson } from "./lib/actor.js";

const WF = "https://pr.transactiondesk.com/";
const RS = "https://signature.therealbrokerage.com/";

/** → the report text: counts and yes/no only, safe to paste into a message. */
export async function runSetupCheck() {
  const rsAsk = await ask(`${RS}*`, { type: "rs:setup" });
  const wfAsk = await ask(`${WF}*`, { type: "webforms:setup" });
  const rs = rsAsk.r, wf = wfAsk.r;
  if (wf && rs?.signedIn && wf.signedIn) {
    wf.samePerson = samePerson({ wfEmail: wf.userEmail, rsEmail: rs.email }); // null → "unknown"
  }
  let text = setupReport({ rs, wf });
  // Which build answered: test copies carry a version_name stamped when they're made
  // (commit, uncommitted changes, time), so a pasted report says what was loaded.
  const m = chrome.runtime.getManifest();
  text = text.replace("\n", `\nVersion: ${m.version_name || m.version}\n`);
  if (!rsAsk.tabs) text += "\n(open Real Signature in a tab to check it)";
  else if (!rs) text += `\n(${rsAsk.tabs === 1 ? "the Real Signature tab" : `none of the ${rsAsk.tabs} Real Signature tabs`} answered — reload ${rsAsk.tabs === 1 ? "it" : "them"} once and run the check again)`
    + (rsAsk.error ? `\n  error: ${rsAsk.error}` : "");
  if (!wfAsk.tabs) text += "\n(open WEBForms in a tab to check it)";
  else if (!wf) text += `\n(${wfAsk.tabs === 1 ? "the WEBForms tab" : `none of the ${wfAsk.tabs} WEBForms tabs`} answered — reload ${wfAsk.tabs === 1 ? "it" : "them"} once and run the check again)`
    + (wfAsk.error ? `\n  error: ${wfAsk.error}` : "");
  // The last draft's steps in seconds — where the wait went. Numbers only: `job` is an
  // internal id, kept out of the report.
  try {
    const { lastTimings: t } = await chrome.storage.local.get("lastTimings");
    if (t) {
      const ago = Math.round((Date.now() - t.at) / 60000);
      const steps = Object.entries(t).filter(([k]) => !["at", "forms", "job"].includes(k)).map(([k, v]) => `${k} ${v}s`).join(", ");
      text += `\nLast draft (${t.forms} form${t.forms === 1 ? "" : "s"}, ${ago} min ago): ${steps}`;
    }
  } catch { /* none yet */ }
  return text;
}
