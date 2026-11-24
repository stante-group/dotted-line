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

/** Page count from uncompressed objects; null when the PDF hides them in compressed object
 *  streams. Only a fallback — WEBForms' own PageCount, or Real's, is preferred.
 *
 *  A PDF saved again (signed, or edited) keeps its old objects and appends the new ones:
 *  a signed contract had 9 page objects for 6 pages after seven signing updates, and
 *  counting them all stopped Auto place with "page count differs" (Dan, 2026-11-22). So
 *  only the newest copy of each object counts, and the page tree's own /Count wins over a
 *  count of pages. */
export function countPages(u8) {
  const latest = new Map();
  for (const m of latin1(u8).matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj/g)) latest.set(m[1], m[2]);
  let total = 0, pages = 0;
  for (const body of latest.values()) {
    if (/\/Type\s*\/Pages(?![a-zA-Z])/.test(body)) {
      // The root holds every page, so it has the largest /Count of the tree's nodes.
      const n = Number(/\/Count\s+(\d+)/.exec(body)?.[1]);
      if (n > total) total = n;
    } else if (/\/Type\s*\/Page(?![a-zA-Z])/.test(body)) pages++;
  }
  return total || pages || null;
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
