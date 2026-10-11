// Layouts = the signature / initial / date blocks of a Real Signature template, with
// everything personal removed. A layout is applied to a FRESH PDF from WEBForms so the
// agent lands on a draft with blocks already placed.
//
// Real Signature identifies a block's signer by a SLOT: signeeType + signeeIndex
// (0-based). "Buyer 2" is BUYER/1. Fields reference validations by `index`, so any
// renumbering must move documentFieldValidations[].fieldIndex with it.

const LAYOUT_KEYS = ["fieldDefinitions", "documentFieldValidations", "signeeConfigs", "pagesCount"];

/** Keep only the blocks. A template read from Real Signature also carries `defaults`
 *  (signer names and emails, the deal, the email body) — none of that may be stored or
 *  shared as a layout. */
export function stripTemplate(template) {
  if (!template || !Array.isArray(template.fieldDefinitions)) {
    throw new Error("template has no fieldDefinitions — Real Signature's shape may have changed");
  }
  const out = {};
  for (const k of LAYOUT_KEYS) {
    if (template[k] !== undefined) out[k] = structuredClone(template[k]);
  }
  out.fieldDefinitions ??= [];
  // A template's typed-in text (defaultValue) belongs to the deal it was made from; a
  // copied block must start empty (Phase 0, 2026-10-11).
  out.fieldDefinitions = out.fieldDefinitions.map((f) => ("defaultValue" in f ? { ...f, defaultValue: null } : f));
  out.documentFieldValidations ??= [];
  out.signeeConfigs ??= [];
  return out;
}

/** Renumber fields 0..n-1 in order, carrying validations along. */
function renumber(fields, validations) {
  const map = new Map();
  const outFields = fields.map((f, i) => {
    map.set(f.index, i);
    return { ...f, index: i };
  });
  const outVals = validations
    .filter((v) => map.has(v.fieldIndex))
    .map((v) => ({ ...v, fieldIndex: map.get(v.fieldIndex) }));
  return { fields: outFields, validations: outVals };
}

/** Remove blocks for signer slots the deal doesn't have — one buyer means Buyer 2's
 *  initials disappear rather than sitting unassignable on every page.
 *  `counts` maps signeeType → how many signers of that type, e.g. {BUYER: 1, SELLER: 2}.
 *  Types not in `counts` are left alone (agents, witnesses). */
export function dropUnusedSlots(layout, counts) {
  const keep = layout.fieldDefinitions.filter((f) => {
    const n = counts[f.signeeType];
    return n === undefined || (f.signeeIndex ?? 0) < n;
  });
  const { fields, validations } = renumber(keep, layout.documentFieldValidations);
  const signeeConfigs = layout.signeeConfigs.map((c) =>
    counts[c.signeeType] === undefined
      ? c
      : { ...c, minNum: Math.min(c.minNum ?? 0, counts[c.signeeType]), maxNum: counts[c.signeeType] });
  return { ...layout, fieldDefinitions: fields, documentFieldValidations: validations, signeeConfigs };
}

/** Shift every block down by `offset` pages (combined-document mode). */
export function offsetPages(layout, offset) {
  return {
    ...layout,
    fieldDefinitions: layout.fieldDefinitions.map((f) => ({
      ...f,
      fieldLocations: (f.fieldLocations || []).map((l) => ({ ...l, pageNum: l.pageNum + offset })),
    })),
  };
}

/** Several forms' layouts → one layout for a single merged PDF, in order. */
export function mergeLayouts(layouts) {
  let offset = 0;
  const fields = [];
  const validations = [];
  const configs = new Map();
  for (const l of layouts) {
    const shifted = offsetPages(l, offset);
    const base = fields.length;
    const idx = new Map();
    shifted.fieldDefinitions.forEach((f, i) => {
      idx.set(f.index, base + i);
      fields.push({ ...f, index: base + i });
    });
    for (const v of l.documentFieldValidations) {
      if (idx.has(v.fieldIndex)) validations.push({ ...v, fieldIndex: idx.get(v.fieldIndex) });
    }
    for (const c of l.signeeConfigs) {
      const prev = configs.get(c.signeeType);
      configs.set(c.signeeType, prev
        ? { ...prev, minNum: Math.max(prev.minNum ?? 0, c.minNum ?? 0), maxNum: Math.max(prev.maxNum ?? 0, c.maxNum ?? 0) }
        : { ...c });
    }
    if (typeof l.pagesCount !== "number") throw new Error("layout without pagesCount cannot be merged");
    offset += l.pagesCount;
  }
  return { fieldDefinitions: fields, documentFieldValidations: validations,
           signeeConfigs: [...configs.values()], pagesCount: offset };
}

/** The PUT /document-templates/{id} body for a fresh one-time draft: the draft's own
 *  identity (name, type, defaults) plus the layout's blocks. PUT is a FULL replace, so
 *  this must carry every key the draft already had. */
export function applyToDraft(draft, layout) {
  if (typeof draft.pagesCount === "number" && typeof layout.pagesCount === "number"
      && draft.pagesCount !== layout.pagesCount) {
    throw new Error(`page count differs (PDF ${draft.pagesCount}, template ${layout.pagesCount}) — the form may have been revised`);
  }
  return {
    ...draft,
    fieldDefinitions: structuredClone(layout.fieldDefinitions),
    documentFieldValidations: structuredClone(layout.documentFieldValidations),
    signeeConfigs: structuredClone(layout.signeeConfigs),
  };
}
