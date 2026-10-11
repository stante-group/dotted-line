// The packet title we prefill. The agent can always edit it; this only saves typing.
//
// Deal forms: the WEBForms transaction's name, plus the address when it's complete and the
// name doesn't already say it. Standalone forms: the form name (or "3 forms") plus the
// address typed into the first form. "Complete" = civic number, street and city.

import { normalizeAddress } from "./deals.js";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const MAX = 120;

/** {streetNumber, streetName, city} → "120 Example Street NW, Calgary", or null. */
export function addressLine(a) {
  if (!a) return null;
  const num = clean(a.streetNumber);
  const street = clean(a.streetName);
  const city = clean(a.city);
  return num && street && city ? `${num} ${street}, ${city}` : null;
}

/** WEBForms GET /api/transactions/Basic/{id} → address parts. */
export function addressFromTransaction(t) {
  return t ? { streetNumber: t.StreetNumber, streetName: t.StreetName, city: t.City } : null;
}

/** AREA form variables (GET /api/formeditor/formfields → FormFieldValues). Other provinces'
 *  forms may name them differently, so a miss just means "no address", never an error. */
export function addressFromFormValues(v) {
  return v ? { streetNumber: v.txtp_streetnum, streetName: v.txtp_street, city: v.txtp_city } : null;
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
  const base = forms.length === 1 ? clean(forms[0].name).replace(/\.pdf$/i, "") : `${forms.length} forms`;
  const addr = addressLine(addressFromFormValues(firstFormValues));
  return cap(addr ? `${base} – ${addr}` : base);
}

/** One line to rank reZEN deals against: the transaction's own address, else the form's. */
export function matchAddress({ transaction, firstFormValues }) {
  if (transaction?.Address && clean(transaction.Address)) return clean(transaction.Address);
  const a = addressFromTransaction(transaction) || addressFromFormValues(firstFormValues);
  const parts = a ? [a.streetNumber, a.streetName, a.city].map(clean).filter(Boolean) : [];
  return parts.length >= 2 ? parts.join(" ") : "";
}
