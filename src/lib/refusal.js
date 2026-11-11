// A read Real Signature turns down with a bare 400 — no message, or only "Bad Request".
//
// Why this exists: one store agent's copy has never made a draft. From 2 November every
// list it asked Real Signature for (open deals, templates, drafts, packets) came back
// "400: Bad Request" and nothing else, and the panel showed them the raw
// "GET /document-templates → 400". Our own account gets 200 on the same calls with the same
// headers, so it's that account, not the request — and Dotted Line can't fix an account. What
// it can do is say so in words, with the one thing it knows that tells the cases apart:
// whose sign-in it is (Real's own profile type, already read on every panel load).
//
// The original message stays at the END, unchanged, so the error report still reads its
// route, status and reason from it (report.js classifyError) — and its new code from the
// words before it.

const STATUS_TEXT = /^(bad request|unauthorized|forbidden|not found|unprocessable entity)\.?$/i;
const BARE_400 = /^(GET) (\/\S*) → 400(?:: (.*))?$/;

/** True for "GET /path → 400" with no reason, or only the HTTP phrase. A write's 400 is
 *  something else (a refused field), and so is a 400 that says why. */
export function isBare400(message) {
  const m = BARE_400.exec(String(message || "").trim());
  return !!m && (!m[3] || STATUS_TEXT.test(m[3].trim()));
}

// The words classifyError keys on (report.js OUR_CODES); change both together.
export const REFUSAL_WORDS = {
  agent: "turned down every request from this sign-in",
  notAgent: "this sign-in isn't an agent's account",
  acting: "turned down every request for the agent you're acting for",
};

/** who: "agent" | "not-agent" | "acting" | "unknown". → the message the panel shows. */
export function refusalMessage(original, who) {
  const tail = ` Real Signature's answer: ${String(original).trim()}`;
  if (who === "acting") {
    return `Real Signature ${REFUSAL_WORDS.acting} without saying why, so there's nothing to load. ` +
      "Check that Real Signature works on its own in this tab, with that agent's templates and drafts showing. " +
      "If it doesn't, Real's support can see why; Dotted Line can't change it. Nothing was made or sent." + tail;
  }
  // Without the reZEN "Real Signature" permission on the assistant's team role, Real Signature never
  // shows the picker and answers every read with a bare 400 (a store user, Nov 2026: rows 68-75).
  if (who === "not-agent") {
    return `Real Signature turned down this sign-in's requests without saying why: ${REFUSAL_WORDS.notAgent}, ` +
      "and Dotted Line works from an agent's templates and deals. If you work for an agent and Real Signature " +
      "lets you act for them, pick them where it asks “Whose documents would you like to access?”, " +
      "then click the extension again. If Real Signature never asks, the agent's team hasn't given you " +
      "Real Signature yet: in reZEN, the team leader opens Teams, your team, Team Administrators, your name, " +
      "and turns on Real Signature under Additional Permissions. Nothing was made or sent." + tail;
  }
  return `Real Signature ${REFUSAL_WORDS.agent} without saying why, so there are no templates or deals to load. ` +
    "Check that Real Signature works on its own in this tab: your templates and drafts should show. " +
    "If they don't, Real's support can see why from your account; Dotted Line can't change it. " +
    "If they do, open Settings, use Check my setup and send us what it says. Nothing was made or sent." + tail;
}

/** The profile type from /users/me → who, for refusalMessage. A TC with no agent picked
 *  has no profile (404) and never gets here: that's the "pick whose documents" screen. */
export function whoFromType(type) {
  if (!type) return "unknown";
  return String(type).toUpperCase() === "AGENT" ? "agent" : "not-agent";
}
