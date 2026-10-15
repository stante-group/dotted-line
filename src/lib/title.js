// The packet title we prefill. The agent can always edit it; this only saves typing.
//
// Deal forms: the WEBForms transaction's name, plus the address when it's complete and the
// name doesn't already say it. Standalone forms: the form name (or "3 forms") plus the
// address typed into the first form. "Complete" = civic number and street; the city is
// added when it's there.

import { normalizeAddress } from "./deals.js";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const MAX = 120;

/** {streetNumber, streetName, city} → "120 Example Street NW, Calgary", or without the city
 *  when the form leaves it blank (agents often skip it on their own city's forms — a title
 *  with no address at all was the result, 2026-10-12). Number and street are required. */
export function addressLine(a) {
  if (!a) return null;
  const num = clean(a.streetNumber);
  const street = clean(a.streetName);
  const city = cityOnly(a.city);
  const unit = clean(a.unit).replace(/^(unit|suite|apt\.?|#)\s*/i, "");
  let line;
  if (num && street) {
    // A unit goes in front, Canada Post style: "1234-120 Example Street".
    line = `${unit ? `${unit}-` : ""}${num} ${street}`;
  } else if (!num && /^\d/.test(street)) {
    // The whole address typed into the street field, civic number left blank ("12, 120-5
    // Example St SE"), seen on a live transaction 2026-10-13. Kept as typed: unit, civic and
    // street can't be told apart reliably, and the agent's own spelling is the safe one.
    // It often runs on to city, province and postal code too; those go the way cityOnly
    // sends them, and the city isn't added a second time.
    line = cityOnly(street).replace(/^,\s*|\s*,$/g, "");
    // A unit field beside it wins the unit's place: "205, 1410 1 Street SE" with unit "#205"
    // → "205-1410 1 Street SE" (it was typed both ways on one form, 2026-10-13).
    if (unit) {
      const esc = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      line = `${unit}-${line.replace(new RegExp(`^(#\\s*)?${esc}\\s*[,\\s-]\\s*`, "i"), "")}`;
    }
    if (city && normalizeAddress(line).endsWith(normalizeAddress(city))) return line;
  } else {
    return null; // no civic number anywhere: too vague for a title
  }
  return city ? `${line}, ${city}` : line;
}

/** "Calgary AB T2G 0A1" → "Calgary": the city field often carries province and postal code. */
function cityOnly(s) {
  return clean(s)
    .replace(/[\s,]*\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b.*$/i, "")
    .replace(/[\s,]+(AB|Alta\.?|Alberta|BC|SK|MB|ON|QC|NB|NS|PE|PEI|NL|YT|NT|NU)\.?$/i, "")
    .trim();
}

/** WEBForms GET /api/transactions/Basic/{id} → address parts. Some transactions have only the
 *  one-line Address; addressLine copes with a whole address in the street part. */
export function addressFromTransaction(t) {
  if (!t) return null;
  const split = clean(t.StreetNumber) || clean(t.StreetName);
  return { unit: t.UnitNumber, streetNumber: t.StreetNumber, streetName: split ? t.StreetName : t.Address, city: t.City };
}

/** AREA form variables (GET /api/formeditor/formfields → FormFieldValues). Other provinces'
 *  forms may name them differently, so a miss just means "no address", never an error. */
export function addressFromFormValues(v) {
  return v ? { unit: v.txtp_unitNumber, streetNumber: v.txtp_streetnum, streetName: v.txtp_street, city: v.txtp_city } : null;
}

function alreadyNamed(name, addr) {
  const [numStreet] = addr.split(",");
  return normalizeAddress(name).includes(normalizeAddress(numStreet));
}

const cap = (s) => (s.length > MAX ? s.slice(0, MAX - 1).trimEnd() + "…" : s);

/** transaction: Basic or null; forms: [{name}]; firstFormValues: FormFieldValues or null. */
export function suggestTitle({ transaction, forms, firstFormValues }) {
  if (transaction && clean(transaction.Name)) {
    const name = clean(transaction.Name);
    const addr = addressLine(addressFromTransaction(transaction));
    return cap(addr && !alreadyNamed(name, addr) ? `${name} – ${addr}` : name);
  }
  const base = forms.length === 1 ? clean(forms[0].name).replace(/\.pdf$/i, "") : listForms(forms);
  const addr = addressLine(addressFromFormValues(firstFormValues));
  return cap(addr ? `${base} – ${addr}` : base);
}

const LIST_MAX = 70; // leaves room for the address within MAX

/** Several standalone forms → "Agreement to Represent Both Seller and Buyer + Addendum - Purchase
 *  Contract", repeats as "×2", trailing "(Designated Agency)"-style asides dropped. Too long
 *  for a title (and an email subject) → the first form and "+ 2 more". */
export function listForms(forms) {
  const counts = new Map();
  for (const f of forms) {
    const n = clean(f.name).replace(/\.pdf$/i, "").replace(/\s*\([^)]*\)\s*$/, "") || "Form";
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  const parts = [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n));
  const all = parts.join(" + ");
  if (all.length <= LIST_MAX || parts.length === 1) return all;
  return `${parts[0]} + ${forms.length - (counts.get([...counts.keys()][0]))} more`;
}

/** One line to rank reZEN deals against: the transaction's own address, else the form's. */
export function matchAddress({ transaction, firstFormValues }) {
  if (transaction?.Address && clean(transaction.Address)) return clean(transaction.Address);
  const a = addressFromTransaction(transaction) || addressFromFormValues(firstFormValues);
  const parts = a ? [a.streetNumber, a.streetName, a.city].map(clean).filter(Boolean) : [];
  return parts.length >= 2 ? parts.join(" ") : "";
}
