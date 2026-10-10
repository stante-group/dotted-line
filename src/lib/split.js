// If WEBForms only hands back one combined PDF, we split it in the browser by each form's
// page count. The plan is checked against the PDF's real page count first — a split that
// is off by one page would put every later form's blocks on the wrong page.

/** forms: [{name, pageCount}] in download order; totalPages: pages in the combined PDF.
 *  Returns [{name, from, to}] with 0-based inclusive page ranges, or throws. */
export function planSplit(forms, totalPages) {
  if (!forms.length) throw new Error("no forms to split");
  let at = 0;
  const out = [];
  for (const f of forms) {
    if (!Number.isInteger(f.pageCount) || f.pageCount < 1) {
      throw new Error(`page count unknown for "${f.name}" — can't split safely`);
    }
    out.push({ name: f.name, from: at, to: at + f.pageCount - 1 });
    at += f.pageCount;
  }
  if (at !== totalPages) {
    throw new Error(`forms add up to ${at} pages but the PDF has ${totalPages} — not splitting`);
  }
  return out;
}
