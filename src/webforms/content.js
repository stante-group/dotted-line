// WEBForms side. Terms-driven rules (PLAN.md "Terms review"):
//   - never changes WEBForms' page (no injected buttons, no restyling);
//   - acts only when the agent clicks Send in OUR side panel;
//   - uses WEBForms' own visible Save / Download controls and keeps the bytes they return,
//     unchanged.
//
// PHASE 0 GAPS — deliberately not implemented yet:
//   - reading which forms are ticked (selection state) without touching the page;
//   - capturing the bytes of the app's own download (see PLAN.md Phase 0 item 6);
//   - open-form Save confirmation (Phase 2).
// Until then this script only reports where the agent is.

function where() {
  const m = location.pathname.match(/\/form\/([^/]+)/);
  if (m) return { page: "form", formId: m[1] };
  const t = location.pathname.match(/\/transaction\/detail\/([^/]+)/i);
  if (t) return { page: "transaction", transactionId: t[1] };
  return { page: "other" };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "webforms:where") {
    reply(where());
    return false;
  }
  if (msg.type === "webforms:collect") {
    reply({ error: "Not built yet — waiting on Phase 0 (how to capture WEBForms' own download)." });
    return false;
  }
  return false;
});
