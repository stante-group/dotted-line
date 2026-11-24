// Which of Real Signature's steps a document or packet is on (Transaction → Edit details →
// Prepare → Review), and when the side panel closes by itself.
//
// Real keeps all four steps at one address, /one-time-documents/document/{id} (or
// /packet/{id}), as far as anyone has seen (api-notes, 2026-10-30): pressing Next changes
// what the page shows, not where it is. So the step is read from the page, read only:
// whatever the content script can see without touching it. Three signals, strongest first:
//   1. the address, in case Real does put the step in it (a path end, ?step=, #review) —
//      never seen yet, and cheap to honour if it ever appears;
//   2. Real's own step bar: the label it marks as current (aria-current, or a class such
//      as "active" / "Mui-active" / "current" / "selected" on an element whose own text
//      is a step's name);
//   3. a button that says only Send (or Send Document / Send Packet): Review is the one
//      step with one. Read, never pressed — Dotted Line never sends.
// No signal → null: the panel then does what it did before 0.4.0, and nothing closes.
// The content script builds the snapshot (src/realsig/content.js stepSnapshot); this file
// only decides from it, so the rules can be tested with invented pages.

export const STEPS = ["transaction", "edit-details", "prepare", "review"];

const NAMES = [
  ["transaction", /^transaction$/],
  ["edit-details", /^edit details$/],
  ["prepare", /^prepare$/],
  ["review", /^review(?: (?:and|&) send)?$/],
];

/** "4", "4.", "✓ Review", "Step 4: Review" → "review"; anything else → null. */
export function stepName(text) {
  const t = String(text || "").toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/^(?:step\s*)?\d+\s*[.:)-]?\s*/, "").replace(/^[^a-z]+/, "").trim();
  if (!t || t.length > 30) return null;
  return NAMES.find(([, re]) => re.test(t))?.[0] || null;
}

const SEND = /^send(?: (?:document|packet|now))?$/i;

/** The step from the address alone, or null. Only a step word as a whole path segment, a
 *  step= value or the hash: "/review" in a document's id can't happen (ids are hex). */
export function stepFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const bits = [u.pathname.split("/").filter(Boolean).at(-1), u.searchParams.get("step"), u.hash.replace(/^#\/?/, "")];
  for (const b of bits) {
    const s = stepName(String(b || "").replace(/[-_]+/g, " "));
    if (s) return s;
  }
  return null;
}

/** snapshot: {url, marked: [{text, strong}], buttons: [text]} — marked are the texts of
 *  elements the page marks as current (strong: by aria-current, not only by a class),
 *  buttons the texts of visible buttons. → {step, by} (by: "url" | "marker" | "send") or
 *  {step: null, by: null}. */
export function stepFromPage({ url = "", marked = [], buttons = [] } = {}) {
  const fromUrl = stepFromUrl(url);
  if (fromUrl) return { step: fromUrl, by: "url" };
  const named = marked.map((m) => ({ step: stepName(m?.text), strong: !!m?.strong })).filter((m) => m.step);
  // aria-current is what a step bar is meant to use; a class is a guess about its styling,
  // so it only counts when nothing says aria-current.
  const best = named.some((m) => m.strong) ? named.filter((m) => m.strong) : named;
  const found = [...new Set(best.map((m) => m.step))];
  // Steps done can keep a mark too ("completed" bars): the furthest one is where the agent is.
  if (found.length) return { step: STEPS.filter((s) => found.includes(s)).at(-1), by: "marker" };
  if (buttons.some((b) => SEND.test(String(b || "").replace(/\s+/g, " ").trim()))) return { step: "review", by: "send" };
  return { step: null, by: null };
}

/** Whether the side panel closes itself now (Dan, 31 Oct / 3 Nov): on Prepare, Real's own
 *  left and right panels can't be closed and the document gets little room, so once the
 *  panel has done its part it gets out of the way. The toolbar icon always brings it back,
 *  so only something that HAPPENED while the panel was open closes it, never opening it:
 *    - "placed": Auto place added blocks;
 *    - "step" to Prepare, when every block Dotted Line would place is already there;
 *    - "step" to Review, when the check found nothing missing.
 *  It stays open whenever there is something to read: a note (lines left for the agent, as
 *  0.3.1's), an error, a check that found something or couldn't run, a choice still to make
 *  (the Set up screen, Who signs as the client?), a one-click summary, or work under way.
 *  s: {event: "opened" | "step" | "placed", step, screen, popup, busy, error, note,
 *      review: {ready} | null, prepare: {full} | null, added} */
export function shouldClose(s = {}) {
  if (s.popup || s.busy || s.error || s.note) return false;
  // Only the screens of a document's own steps: Set up ("rs") is a choice waiting, the
  // one-click summary ("made") is there to be read, and the rest aren't on a document.
  if (s.screen !== "dr" && s.screen !== "rv") return false;
  if (s.event === "placed") return (s.added || 0) > 0;
  if (s.event !== "step") return false;
  if (s.step === "review") return s.review?.ready === true;
  if (s.step === "prepare") return s.prepare?.full === true;
  return false;
}
