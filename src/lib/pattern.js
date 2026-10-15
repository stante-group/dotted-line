// The agent's own title and email-subject patterns (Settings page).
//
// Fill-in words in braces, not regex: "{address} – {forms}". Most agents can read and write
// that; few could write a regex, and building text isn't what regex is for. A word with no
// value for this hand-off (no {mls} on a standalone form) drops out together with the dash,
// colon or brackets that only made sense next to it, so a pattern never leaves "– –" or
// "()" behind.

import { addressLine, addressFromTransaction, addressFromFormValues, listForms } from "./title.js";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const MAX = 120;

/** The words, in the order the Settings page lists them, with what each one is. */
export const WORDS = [
  ["address", "Full address: unit, civic number, street, city"],
  ["street", "Civic number and street"],
  ["unit", "Unit number"],
  ["city", "City"],
  ["forms", "The form's name, or several shortened and joined with +"],
  ["deal", "The WEBForms deal's name"],
  ["mls", "MLS® number from the WEBForms deal"],
  ["agent", "Who's signed in to WEBForms"],
  ["date", "Today's date"],
  ["title", "The title (email subject only)"],
];

/** How a fresh install behaves: the suggested title, and the same words as the signers'
 *  email subject (asked for 2026-10-13 — before that, Real Signature's own subject stood). */
export const DEFAULT_SETTINGS = Object.freeze({
  titleMode: "suggested",  // "suggested" | "blank" | "pattern"
  titlePattern: "{address} – {forms}",
  subjectMode: "title",    // "title" | "pattern" | "real" (leave Real Signature's own)
  subjectPattern: "Please sign: {forms} – {address}",
  // One click (src/lib/auto.js), asked for 2026-10-14: make the draft straight away when
  // nothing needs the agent. Starting from the icon click itself is opt-in — it skips the
  // last look at the title.
  autoCreate: true,
  startOnOpen: false,
});

const GAP = "\u0000";
const SEP = "[–—\\-:|,·/]";

/** pattern + {word: value} → text. Unknown words stay as typed, so a typo shows up in the
 *  preview instead of silently vanishing. */
export function fillPattern(pattern, values) {
  let s = String(pattern ?? "").replace(/\{(\w+)\}/g, (m, w) => {
    const k = w.toLowerCase();
    if (!WORDS.some(([name]) => name === k)) return m;
    const v = clean(values?.[k]);
    return v || GAP;
  });
  // An empty word takes its brackets, then one separator next to it, with it.
  s = s.replace(new RegExp(`[(\\[]\\s*${GAP}\\s*[)\\]]`, "g"), GAP);
  s = s.replace(new RegExp(`\\s*${SEP}\\s*${GAP}`, "g"), "");
  s = s.replace(new RegExp(`${GAP}\\s*${SEP}\\s*`, "g"), "");
  s = clean(s.split(GAP).join(" "));
  s = s.replace(new RegExp(`^(${SEP}|\\s)+|(${SEP}|\\s)+$`, "g"), "");
  return s.length > MAX ? s.slice(0, MAX - 1).trimEnd() + "…" : s;
}

/** Everything a pattern can use, from what the panel already read from WEBForms.
 *  forms: [{name}] — their TYPE names by now. */
export function titleValues({ transaction = null, forms = [], firstFormValues = null, agent = null, now = new Date() }) {
  const fromForm = addressFromFormValues(firstFormValues);
  const parts = { ...(fromForm || {}), ...stripEmpty(addressFromTransaction(transaction)) };
  const street = clean(parts.streetNumber) && clean(parts.streetName) ? `${clean(parts.streetNumber)} ${clean(parts.streetName)}` : "";
  return {
    address: addressLine(parts) || "",
    street,
    unit: clean(fromForm?.unit).replace(/^(unit|suite|apt\.?|#)\s*/i, ""),
    city: clean(parts.city),
    forms: forms.length === 1 ? clean(forms[0].name).replace(/\.pdf$/i, "") : forms.length ? listForms(forms) : "",
    deal: clean(transaction?.Name),
    mls: clean(transaction?.MLSNumber),
    agent: clean(agent),
    date: now.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }),
  };
}

function stripEmpty(o) {
  return o ? Object.fromEntries(Object.entries(o).filter(([, v]) => clean(v))) : {};
}

/** The title the panel prefills: the suggestion, nothing, or the agent's pattern. */
export function titleFor(settings, values, suggested) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (s.titleMode === "blank") return "";
  if (s.titleMode === "pattern") return fillPattern(s.titlePattern, values) || suggested;
  return suggested;
}

/** The signers' email subject, or null to leave Real Signature's own. */
export function subjectFor(settings, values, title) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (s.subjectMode === "real") return null;
  if (s.subjectMode === "pattern") return fillPattern(s.subjectPattern, { ...values, title }) || title || null;
  return title || null;
}

/** Sample values for the Settings preview — invented, never a real deal. */
export const SAMPLE_VALUES = {
  address: "1234-120 Example Street NW, Calgary",
  street: "120 Example Street NW",
  unit: "1234",
  city: "Calgary",
  forms: "Agreement to Represent Both Seller and Buyer + Addendum - Purchase Contract",
  deal: "Offer - Jordan Sample",
  mls: "A0000000",
  agent: "Alex Example",
  date: new Date().toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }),
};
