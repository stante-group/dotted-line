// A DocuSign template export (Templates → Download: one .json per template, several in a
// .zip) → the parts of a Real Signature template: its PDF, and signature, initials and
// date blocks per signer slot. Pure and read-only; the Settings page shows the result and
// the Real Signature tab makes the template (docs/api-notes.md "Importing a DocuSign
// template").
//
// Export shape (seen 2026-10-15, the agent's own purchase-contract template): every value is
// a STRING. `documents[] {documentId, name, pages, documentBase64}`; `recipients.signers[]
// {recipientId, roleName, routingOrder, tabs: {signHereTabs, initialHereTabs,
// dateSignedTabs, textTabs, …}}`; each tab `{documentId, pageNumber, xPosition,
// yPosition, optional, anchorString?}`. Positions are PDF points from the page's TOP-left;
// Real Signature's are from the BOTTOM-left, as [x1, y1, x2, y2] (docs/api-notes.md).
// The PDF inside can be permission-locked (encrypted), so its page sizes can't be read here;
// Real Signature accepted it as-is.

/** DocuSign tab list → Real Signature block, with the box Real's own editor uses for that
 *  block (sizes from the agent's templates) and how far below DocuSign's y its top sits.
 *  `down` was measured, not guessed: the same AREA purchase contract set up by hand in both
 *  tools put Real's boxes 10 (signature) and 13 (initials) points lower, and the converted
 *  blocks then sat on the form's lines in Real's editor (2026-10-15). DocuSign's date-signed
 *  is a date AND time, so it becomes Real's "Date & Time" (SIGNED_DATE), not "Signed Date"
 *  (date only) — the agent's forms need the time (Dan, 2026-10-15). */
export const BLOCKS = {
  signHereTabs: { type: "SIGNATURE", w: 150, h: 21, down: 10, fontSize: 22, label: "Signature" },
  initialHereTabs: { type: "INITIALS", w: 40, h: 25, down: 13, fontSize: 22, label: "Initials" },
  dateSignedTabs: { type: "SIGNED_DATE", w: 65, h: 21, down: 0, fontSize: 11, label: "Date & Time" },
  // Fields the signer fills in, or Real fills from the signer. DocuSign gives text boxes a
  // width and height (`sized`); a name box comes with 0×0, so it gets Real's own 150×15.
  // Types and sizes as in the agent's Real templates (2026-10-15): SIGNEE_NAME, STRING,
  // NUMBER, DATE, all 150×15 at font size 14.
  fullNameTabs: { type: "SIGNEE_NAME", w: 150, h: 15, down: 0, fontSize: 14, label: "Signee Name" },
  textTabs: { type: "STRING", w: 150, h: 15, down: 0, fontSize: 14, label: "Text", sized: true, typed: true },
  numberTabs: { type: "NUMBER", w: 150, h: 15, down: 0, fontSize: 14, label: "Number", sized: true, typed: true },
  dateTabs: { type: "DATE", w: 150, h: 15, down: 0, fontSize: 14, label: "Date", sized: true, typed: true },
  // Ticks: 10×10 in Real (the agent's seller agreement template, 2026-10-15), each radio
  // button its own field, a group held together by a rule over their indexes. DocuSign's
  // tick is bigger (~16), so Real's box is centred on it: 3 right and 3 down. Corner to
  // corner, they sat up and left of the form's boxes in Real's editor (seller agreement,
  // a DocuSign copy made by hand to compare, 2026-10-15). Hand-placed DocuSign ticks are
  // only roughly on the boxes themselves, so the agent checks them in Real's editor.
  checkboxTabs: { type: "BOOLEAN", w: 10, h: 10, down: 3, right: 3, fontSize: 14, label: "Checkbox", typed: true },
  radios: { type: "RADIO", w: 10, h: 10, down: 3, right: 3, fontSize: 14, label: "Radio" },
};

// DocuSign checkbox group rules → Real's: "tick at least one" and "tick exactly one".
// Any other rule (at most N, a range) has no Real equivalent; the boxes still come over.
function checkboxRule(g) {
  const min = num(g?.minimumRequired);
  if (g?.groupRule === "SelectAtLeast" && min >= 1) return "REQUIRED_AT_LEAST_ONE";
  if (g?.groupRule === "SelectExactly" && min === 1) return "REQUIRED_ONLY_ONE";
  return null;
}

/** Letter, in points. Every CREA/AREA form is letter-size; a block lower than this is
 *  refused rather than placed off the page. */
export const LETTER_HEIGHT = 792;

// The recipient kinds that sign. Carbon copies, editors and the like have no blocks to bring.
const SIGNING = ["signers", "inPersonSigners", "witnesses"];

const TAB_WORDS = {
  textTabs: "text field", fullNameTabs: "name field", emailAddressTabs: "email field",
  checkboxTabs: "checkbox", radioGroupTabs: "radio group", listTabs: "list", numberTabs: "number field",
  dateTabs: "date field", companyTabs: "company field", titleTabs: "title field", noteTabs: "note",
  formulaTabs: "formula", signerAttachmentTabs: "attachment", approveTabs: "approve button",
  declineTabs: "decline button", initialHereTabs: "initials", signHereTabs: "signature", dateSignedTabs: "date signed",
};

const num = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));

/** Parse one export. Throws a plain message when it isn't one. */
export function readDocusignTemplate(json) {
  const d = typeof json === "string" ? JSON.parse(json.replace(/^﻿/, "")) : json;
  if (!d || typeof d !== "object" || !Array.isArray(d.documents) || !d.recipients || typeof d.recipients !== "object") {
    throw new Error("not a template file this can read — download the template again from your e-sign tool");
  }
  const documents = d.documents.map((doc) => ({
    id: String(doc.documentId),
    name: String(doc.name || "Document"),
    pages: num(doc.pages),
    base64: typeof doc.documentBase64 === "string" ? doc.documentBase64 : null,
  }));
  if (!documents.length) throw new Error("this template file has no document in it");
  const roles = [];
  for (const kind of SIGNING) {
    for (const r of d.recipients[kind] || []) {
      roles.push({
        key: String(r.recipientId),
        roleName: String(r.roleName || r.name || "Signer").trim(),
        order: num(r.routingOrder) || 1,
        tabs: r.tabs && typeof r.tabs === "object" ? r.tabs : {},
      });
    }
  }
  return { name: String(d.name || "Imported template").trim(), documents, roles };
}

/** What a role name most likely means in Real Signature: {signeeType, signeeIndex}, or
 *  {agent: true} for an agent whose side the name doesn't say, or null. */
export function guessRole(roleName) {
  const s = String(roleName).toLowerCase().replace(/[’']/g, "");
  const n = /(?:^|\D)(\d)\s*$/.exec(s);
  let index = n ? Math.max(0, Number(n[1]) - 1) : 0;
  if (/\bco-?\s?(buyer|seller|purchaser|vendor)|\bsecond\b|\b2nd\b/.test(s)) index = Math.max(index, 1);
  // Agent first: "Buyers Agent" contains "buyer".
  if (/agent|realtor|brokerage|representative|associate|licensee/.test(s)) {
    if (/listing|seller|vendor/.test(s)) return { signeeType: "SELLERS_AGENT", signeeIndex: 0 };
    if (/buyer|purchaser|selling agent/.test(s)) return { signeeType: "BUYERS_AGENT", signeeIndex: 0 };
    return { agent: true };
  }
  if (/buyer|purchaser|tenant|lessee/.test(s)) return { signeeType: "BUYER", signeeIndex: index };
  if (/seller|vendor|landlord|lessor|owner/.test(s)) return { signeeType: "SELLER", signeeIndex: index };
  return null;
}

/** First guesses for every role, with two roles never landing on one slot ("Buyer" and
 *  "Buyer 1" both read as Buyer 1, so the second moves to Buyer 2). → {key: slot|null} */
export function guessRoles(roles) {
  const taken = new Set();
  const out = {};
  for (const r of roles) {
    const g = guessRole(r.roleName);
    if (!g?.signeeType) { out[r.key] = null; continue; }
    let i = g.signeeIndex;
    while (taken.has(`${g.signeeType}#${i}`)) i++;
    taken.add(`${g.signeeType}#${i}`);
    out[r.key] = { signeeType: g.signeeType, signeeIndex: i };
  }
  return out;
}

/** The blocks a role has on one document, and what can't come across. */
export function roleBlocks(role, docId) {
  const blocks = [];
  const left = {};
  const groups = new Map((role.tabs.tabGroups || []).map((g) => [g.groupLabel, g]));
  for (const [list, tabs] of Object.entries(role.tabs)) {
    if (!Array.isArray(tabs) || list === "tabGroups") continue; // tabGroups are checkbox rules, not fields
    if (list === "radioGroupTabs") {
      tabs.forEach((g, gi) => {
        const radios = (g.radios || []).filter((r) => String(r.documentId ?? g.documentId) === String(docId));
        if (!radios.length) return;
        const place = radios.map((r) => [num(r.xPosition), num(r.yPosition), num(r.pageNumber)]);
        if (String(g.locked) === "true" || radios.some((r) => String(r.locked) === "true" || r.anchorString)
            || !place.every((p) => p.every(Number.isFinite))) {
          left["radio group"] = (left["radio group"] || 0) + 1;
          return;
        }
        // DocuSign radios are required unless they say otherwise; Real's rule is "exactly one".
        const required = radios.some((r) => String(r.required) !== "false");
        for (const [x, y, page] of place) {
          blocks.push({ list: "radios", page, x, y, optional: true, group: `radio:${gi}`, rule: required ? "REQUIRED_ONLY_ONE" : null });
        }
      });
      continue;
    }
    for (const t of tabs) {
      if (String(t.documentId) !== String(docId)) continue;
      const spec = BLOCKS[list];
      const x = num(t.xPosition), y = num(t.yPosition), page = num(t.pageNumber);
      // A block pinned to words ("anchor") has no fixed spot until DocuSign reads the PDF.
      // A LOCKED text box is the sender's own wording, not something the signer fills in;
      // a template's typed-in text never rides along (layout.js clears defaultValue).
      const locked = spec?.typed && String(t.locked) === "true";
      if (spec && !locked && !t.anchorString && [x, y, page].every(Number.isFinite)) {
        const w = num(t.width), h = num(t.height);
        // A checkbox in a DocuSign group follows the group's rule, not its own "required".
        const label = list === "checkboxTabs" ? (t.tabGroupLabels || []).find((l) => groups.has(l)) : undefined;
        const rule = label !== undefined ? checkboxRule(groups.get(label)) : null;
        blocks.push({
          list, page, x, y,
          // Signature blocks say "optional"; boxes to type in say "required".
          optional: label !== undefined || (spec.typed ? String(t.required) !== "true" : String(t.optional) === "true"),
          ...(spec.sized && w > 0 && h > 0 ? { w, h } : {}),
          ...(label !== undefined ? { group: `check:${label}`, rule } : {}),
        });
      } else {
        const why = locked ? "locked " + TAB_WORDS[list] : spec ? "anchored " + TAB_WORDS[list] : TAB_WORDS[list] || list.replace(/Tabs$/, " field");
        left[why] = (left[why] || 0) + 1;
      }
    }
  }
  return { blocks, left };
}

/** "2 text fields, 1 checkbox" */
export function leftOutText(left) {
  return Object.entries(left).map(([w, n]) => `${n} ${w}${n === 1 ? "" : w.endsWith("x") ? "es" : "s"}`).join(", ");
}

const round = (v) => Math.round(v * 10) / 10;

/** One document of an export → the PUT fields of a new Real Signature template.
 *  slots: {roleKey: {signeeType, signeeIndex} | null (leave that role out)}. */
export function buildTemplate(parsed, docId, slots, { pageHeight = LETTER_HEIGHT } = {}) {
  const doc = parsed.documents.find((x) => x.id === String(docId));
  if (!doc) throw new Error("that document isn't in this template");
  if (!Number.isInteger(doc.pages) || doc.pages < 1) throw new Error(`couldn't read how many pages "${doc.name}" has`);
  const used = new Set();
  for (const r of parsed.roles) {
    const s = slots[r.key];
    if (!s) continue;
    const k = `${s.signeeType}#${s.signeeIndex}`;
    if (used.has(k)) throw new Error("two roles are set to the same signer — give each its own");
    used.add(k);
  }
  const fieldDefinitions = [];
  const documentFieldValidations = [];
  const labels = {};
  const most = {};
  const rules = new Map(); // "role|group" → {rule, indexes}
  for (const r of parsed.roles) {
    const s = slots[r.key];
    if (!s) continue;
    for (const b of roleBlocks(r, doc.id).blocks) {
      if (b.group) {
        const g = rules.get(`${r.key}|${b.group}`) || { rule: b.rule, indexes: [] };
        g.indexes.push(fieldDefinitions.length);
        rules.set(`${r.key}|${b.group}`, g);
      }
      const spec = BLOCKS[b.list];
      const w = b.w ?? spec.w, h = b.h ?? spec.h;
      if (b.page > doc.pages) throw new Error(`a ${spec.label.toLowerCase()} block is on page ${b.page}, but "${doc.name}" has ${doc.pages} pages`);
      const top = pageHeight - (b.y + spec.down);
      if (top - h < 0) throw new Error(`a ${spec.label.toLowerCase()} block on page ${b.page} is below the bottom of a letter-size page`);
      const index = fieldDefinitions.length;
      labels[spec.type] = (labels[spec.type] || 0) + 1;
      fieldDefinitions.push({
        index,
        type: spec.type,
        signeeType: s.signeeType,
        signeeIndex: s.signeeIndex,
        formatting: { fontSize: spec.fontSize, rotationAngle: 0 },
        fieldLocations: [{ position: [round(b.x + (spec.right || 0)), round(top - h), round(b.x + (spec.right || 0) + w), round(top)], pageNum: b.page }],
        displayName: `${spec.label} ${labels[spec.type]}`,
        defaultValue: null,
        readonly: false,
      });
      if (!b.optional) documentFieldValidations.push({ validationType: "REQUIRED", fieldIndex: index, relatedFieldIndexes: [] });
      most[s.signeeType] = Math.max(most[s.signeeType] || 0, s.signeeIndex + 1);
    }
  }
  if (!fieldDefinitions.length) throw new Error(`no signature, initials or date blocks to bring over from "${doc.name}"`);
  // Group rules the way Real's own editor saves them: no fieldIndex, the members listed.
  for (const { rule, indexes } of rules.values()) {
    if (rule) documentFieldValidations.push({ validationType: rule, fieldIndex: null, relatedFieldIndexes: indexes });
  }
  return {
    name: parsed.documents.length > 1 ? `${parsed.name} – ${doc.name.replace(/\.pdf$/i, "")}` : parsed.name,
    pagesCount: doc.pages,
    fieldDefinitions,
    documentFieldValidations,
    signeeConfigs: Object.entries(most).map(([signeeType, maxNum]) => ({ signeeType, minNum: 0, maxNum })),
  };
}
