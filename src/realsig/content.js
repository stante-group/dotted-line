// Real Signature side. Runs in the signature.therealbrokerage.com tab so every API call
// goes out with the page's own origin and sign-in. Draft only — see src/lib/realsig-api.js.
//
// Flow once a job is bound to this tab:
//   1. agent picks the reZEN deal (ranked, agent + address shown, wrong-deal warnings);
//   2. agent confirms a template per form (remembered; refused on page-count mismatch);
//   3. per form: upload PDF as a one-time draft → PUT draft with the template's blocks,
//      unused signer slots removed, deal attached, signers pre-filled;
//   4. job deleted; agent lands on the draft and presses Send themselves.
//
// PHASE 0 GAPS: template→fresh-PDF round trip (clone+swap vs copy blocks), position units,
// packets, the draft's URL to land on, the signed-in user's yentaId for the deal list.
// The panel UI for steps 1–2 is not built yet.

(async () => {
  const job = await chrome.runtime.sendMessage({ type: "job:forTab" });
  if (!job || job.error) return;

  const lib = (p) => import(chrome.runtime.getURL(`src/lib/${p}`));
  const { RealSignature, readToken, NotSignedIn } = await lib("realsig-api.js");
  const rs = new RealSignature({ getToken: () => readToken(document.cookie) });

  try {
    await rs.listTemplates({ size: 1 }); // sign-in check only
  } catch (e) {
    if (e instanceof NotSignedIn) {
      // Real's own login is showing; the job stays bound to this tab and this script runs
      // again after sign-in reloads the page.
      return;
    }
    throw e;
  }
  console.info("[wf→rs] job ready:", job.forms?.length ?? 0, "form(s) — deal/template picker not built yet (Phase 1)");
})();
