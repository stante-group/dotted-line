// Read-only checks on a PDF's bytes. Nothing here changes a PDF (PLAN rule 4).

const latin1 = (u8) => new TextDecoder("latin1").decode(u8);

export function isPdf(u8) {
  return u8.length > 5 && latin1(u8.subarray(0, 5)) === "%PDF-";
}

/** A fillable PDF isn't the flattened form WEBForms' "Save as PDF" and zip produce —
 *  it's "Save as Editable PDF" or the combined print. Real Signature would show the
 *  fields' current values while signers sign a different document underneath. */
export function hasAcroForm(u8) {
  return latin1(u8).includes("/AcroForm");
}

/** Page count from uncompressed page objects; null when the PDF hides them in compressed
 *  object streams. Only a fallback — WEBForms' own PageCount is preferred. */
export function countPages(u8) {
  const n = (latin1(u8).match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
  return n || null;
}

export function toBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
