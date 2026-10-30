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
    // One form too: its trailing "(Designated Agency)"-style aside goes (Dan, 2026-10-15).
    forms: forms.length ? listForms(forms) : "",
    deal: clean(transaction?.Name),
    mls: clean(transaction?.MLSNumber),
    agent: clean(agent),
    date: now.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }),
  };
}

/** An uploaded file's name as a form name: "3. Signed-Residential_Purchase_Contract (2).pdf"
 *  → "Residential Purchase Contract". Downloads pick up numbering, copy counters and
 *  "Signed-"; none of that is the form. */
export function formNameFromFile(fileName) {
  const n = clean(String(fileName ?? "").replace(/\.pdf$/i, "").replace(/_+/g, " ")
    .replace(/^\s*\d+[.)]\s*/, "").replace(/^signed[\s-]+/i, "").replace(/\s*\(\d+\)\s*$/, ""));
  return n || "Form";
}

/** The pattern words for a draft uploaded in Real Signature: the form from the file name,
 *  the place from the reZEN deal picked in the panel (its one-line address: street, city,
 *  province, postal code). No deal: the form and the date only, so "Please sign: {forms} –
 *  {address}" still says what to sign. {deal} and {agent} are WEBForms' and stay empty. */
export function draftTitleValues({ fileName, deal = null, now = new Date() }) {
  const [street = "", city = ""] = String(deal?.address ?? "").split(",").map(clean);
  return {
    address: [street, city].filter(Boolean).join(", "),
    street,
    unit: "",
    city,
    forms: listForms([{ name: formNameFromFile(fileName) }]),
    deal: "",
    mls: clean(deal?.mlsNum),
    agent: "",
    date: now.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }),
  };
}

/** An uploaded draft's subject: the agent's own, but never the pattern's fixed words alone.
 *  "Please sign: {deal} – {address}" with no WEBForms deal and no reZEN deal came out as a
 *  bare "Please sign" (Dan's test, 2026-10-30): then the title goes after it, "Please sign:
 *  BCFSA - Disclosure of Remuneration". */
export function draftSubject(settings, values, title) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const subject = subjectFor(s, values, title);
  if (s.subjectMode !== "pattern" || !subject || !title || subject !== fillPattern(s.subjectPattern, {})) return subject;
  return `${subject}: ${title}`;
}

/** The suggested title for an uploaded draft: "120 Example Street NW – Residential Purchase
 *  Contract", or the form alone with no deal (the shape WEBForms' suggestion has). */
export function draftTitle(values) {
  return [values.street, values.forms].filter(Boolean).join(" – ");
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
