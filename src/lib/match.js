// Which Real Signature template goes with which WEBForms form.
// The agent chooses once; we remember it by the form's identity and suggest by name after.
// A remembered choice is still refused if the page count no longer matches — provincial
// associations revise their forms, and a block on the wrong page is worse than no block.

export function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\.pdf$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Stable key for a form. FormGUID identifies the form definition across deals; the
 *  name is the fallback when only the forms list (no editor) has been read. */
export function formKey(form) {
  return form.formGuid ? `guid:${form.formGuid}` : `name:${normalizeName(form.name)}`;
}

export function checkPages(form, template) {
  if (typeof form.pageCount !== "number" || typeof template.pagesCount !== "number") {
    return { ok: false, reason: "page count unknown — can't confirm this template fits" };
  }
  if (form.pageCount !== template.pagesCount) {
    return { ok: false, reason: `form has ${form.pageCount} pages, template has ${template.pagesCount}` };
  }
  return { ok: true };
}

function overlap(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}

/** Pick a template for a form: the remembered one if it still exists and fits,
 *  otherwise name suggestions (best first) that fit. Never auto-applies a suggestion —
 *  the caller shows it to the agent. */
export function suggestTemplate(form, templates, remembered = {}) {
  const key = formKey(form);
  const chosen = remembered[key] && templates.find((t) => t.id === remembered[key]);
  if (chosen) {
    const fit = checkPages(form, chosen);
    return { remembered: fit.ok ? chosen : null, refused: fit.ok ? null : { template: chosen, reason: fit.reason }, suggestions: [] };
  }
  const name = normalizeName(form.name);
  const suggestions = templates
    .map((t) => ({ template: t, score: overlap(name, normalizeName(t.name)) }))
    .filter((s) => s.score >= 0.5 && checkPages(form, s.template).ok)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.template);
  return { remembered: null, refused: null, suggestions };
}
