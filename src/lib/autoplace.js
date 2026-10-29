// Blocks placed from the form's own printed labels, for a form the agent has no template
// for: "Signature of Seller" under a line → a signature block on that line, "Buyer's
// Initials ____ ____" in a footer → initials on every page, "Signed and dated … on ____"
// → a date. Pure: it reads where the words are (pdftext.js) and returns a layout in the
// shape layout.js applies, so the rest of the draft is built as for a template. It's a
// first guess the agent checks in Real Signature before sending — a draft, as always.
//
// Labels are Alberta's (AREA, checked on 6 forms 2026-10-29), Manitoba's (MREA, 5 forms
// 2026-10-29) and Ontario's (OREA Form 100, 2024). A province whose labels aren't here finds nothing, and nothing is placed.

import { BLOCKS } from "./docusign.js";

const SIG = BLOCKS.signHereTabs, INI = BLOCKS.initialHereTabs, DATE = BLOCKS.dateSignedTabs;
// Real Signature's time-only and date-only stamps (field types in docs/api-notes.md). The
// time blank is about 40pt on AREA forms and 30pt on MREA's; the date blank takes Date & Time's width.
const TIME = { type: "SIGNED_TIME_ONLY", w: 34, h: 21, fontSize: 11, label: "Signed Time" };
const DATE_ONLY = { type: "SIGNED_DATE_ONLY", w: 65, h: 21, fontSize: 11, label: "Signed Date" };

// ---------------------------------------------------------------- reading the page

/** Words on one baseline → lines: {text, xs (start of each character), x1, y, size}. */
export function toLines(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!it.str) continue;
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(1.5, 0.25 * it.size));
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => {
    let text = "", end = null;
    const xs = [];
    let size = 0;
    for (const it of r.items.sort((a, b) => a.x - b.x)) {
      // A gap wider than a fifth of the type size is a space the PDF didn't spell out.
      if (end !== null && it.x - end > 0.2 * it.size && !text.endsWith(" ")) { xs.push(end); text += " "; }
      it.str.split("").forEach((ch, i) => { xs.push(it.xs?.[i] ?? it.x + (it.w * i) / it.str.length); text += ch; });
      end = it.x + it.w;
      size = Math.max(size, it.size);
    }
    return { text, xs, x1: end, y: r.y, size };
  });
}

const xAt = (line, i) => (i < line.xs.length ? line.xs[i] : line.x1);

/** Horizontal rules a signer writes on: stroked lines and hairline boxes, 30pt or longer. */
function rulesOf(shapes) {
  return (shapes || []).filter((s) => {
    const w = s.x2 - s.x1, h = Math.abs(s.y2 - s.y1);
    return s.rect ? h <= 2 && w >= 30 : h <= 1 && Math.abs(w) >= 30;
  }).map((s) => ({ x1: Math.min(s.x1, s.x2), x2: Math.max(s.x1, s.x2), y: Math.max(s.y1, s.y2) }));
}

/** Small boxes to put initials in (Manitoba draws them beside "Initials (Buyer)"). */
function boxesOf(shapes) {
  return (shapes || []).filter((s) => s.rect && s.x2 - s.x1 >= 12 && s.x2 - s.x1 <= 70 && s.y2 - s.y1 >= 8 && s.y2 - s.y1 <= 30);
}

/** The line a label sits under: the nearest rule just above its baseline that spans it. */
function ruleAbove(rules, x, xEnd, y, size) {
  let best = null;
  for (const r of rules) {
    const d = r.y - y;
    if (d < 0 || d > 2.2 * size + 6) continue;
    if (r.x1 > x + 4 || r.x2 < Math.min(xEnd, x + 20)) continue;
    if (!best || d < best.y - y) best = r;
  }
  return best;
}

/** Whether text[start, end) is set apart from the words either side of it by more than a
 *  couple of letters' width: a name of its own rather than a word in a phrase. */
function standsAlone(line, start, end) {
  const t = line.text;
  let p = start - 1;
  while (p >= 0 && t[p] === " ") p--;
  let n = end;
  while (n < t.length && t[n] === " ") n++;
  const gap = 2.5 * line.size;
  if (p >= 0 && xAt(line, start) - xAt(line, p) < gap) return false;
  if (n < t.length && xAt(line, n) - xAt(line, end - 1) < gap) return false;
  return true;
}

/** A line that starts just after a label, on its baseline. */
function ruleRight(rules, xEnd, y) {
  return rules.find((r) => Math.abs(r.y - y) <= 3 && r.x1 >= xEnd - 4 && r.x1 <= xEnd + 30) || null;
}

// ---------------------------------------------------------------- the labels

const ROLE = (w) => {
  const s = w.toLowerCase();
  if (/brokerage representative|brokerage’s representative|brokerage's representative/.test(s)) {
    if (/buyer/.test(s)) return "BUYERS_AGENT";
    if (/seller/.test(s)) return "SELLERS_AGENT";
    return "AGENT";
  }
  if (/buyer/.test(s)) return "BUYER";
  if (/seller/.test(s)) return "SELLER";
  if (/consumer/.test(s)) return "CLIENT"; // the agent's own clients, whichever side (forClients)
  return null;
};

// "Signature of Seller", "Signature of Buyer", "Signature of Brokerage Representative"
// (AREA, MREA); "Buyer Signature", "Seller Signature" (AREA purchase contracts). Witness and
// non-owner spouse lines have no Real Signature role and are left for the agent.
// Case matters: a sentence ("the seller's signature") or a heading ("Date and Buyer's
// Signature") isn't a line to sign on, and neither is Manitoba's deposit receipt ("Signature
// of brokerage representative"), signed only when cash changes hands.
// Ontario's "(Signature of Seller or Buyer)" confirms acceptance — whoever accepted last.
const SIGNATURE_LABEL = /\bSignature of (?:the )?(Seller|Buyer|Brokerage Representative)\b(?! or\b)|\b(Buyer|Seller|Consumer) Signature\b/g;
// Saskatchewan (SREC purchase contract) prints them in capitals, one with a stray
// apostrophe: "BUYER' SIGNATURE_____", "SELLER'S SIGNATURE_____". Capitals are a heading
// as often as a line, so these count only with a line to sign on.
const SIGNATURE_CAPS = /\b(BUYER|SELLER)['’]?S?['’]? SIGNATURE(?![A-Z])/g; // its underscores follow with no space
// "Seller's Initials ____ ____ Buyer's Initials ____ ____" (AREA page footers and schedules).
const INITIALS_RUNS = /\b(Seller|Buyer|Brokerage Representative)['’]?s? Initials\s*((?:_{4,}\s*)+)/gi;
// "Initials (Buyer)" beside a drawn box (MREA offer, page 1).
const INITIALS_BOX = /\bInitials \((Buyer|Seller|Buyer['’]s brokerage representative|Seller['’]s brokerage representative)\)/gi;
// A line that is nothing but signers' names under their lines: "Buyer Buyer", "Witness
// Seller", "Buyer Seller" (MREA offer and disclosure statement).
const BARE_ROLES = /^(?:\s*(?:Buyer|Seller|Witness|Signature|Authori[sz]ed Brokerage Representative))+\s*$/i;
// The names in such a row that sign. Saskatchewan: "WITNESS SELLER Authorized Brokerage
// Representative" (Seller's MLS Brokerage Contract) and "Witness Signature" (Agency
// Disclosure, signed by whichever client it's given to: CLIENT, as RECA's "Consumer").
const BARE_SIGNER = /\b(Buyer|Seller|Signature|Authori[sz]ed Brokerage Representative)\b/gi;
const bareRole = (w) => (/^signature$/i.test(w) ? "CLIENT" : ROLE(w));
// "Seller(s) Initials" under a line (Saskatchewan's Seller's MLS Brokerage Contract page
// footers): both sellers' initials on that one line, side by side.
const INITIALS_UNDER = /\b(Seller|Buyer)\(s\) Initials\b/gi;
// Ontario (OREA) signing rows: "(Witness) (Buyer) (Seal) (Date)" under a dotted line, and the
// acknowledgement's "(Seller) (Date) (Buyer) (Date)". Only on a row with (Witness), (Seal)
// or (Date) — "(Buyer)" in a sentence is just a word.
const PAREN_ROW = /\((?:Witness|Seal|Date)\)/;
const PAREN_ROLE = /\((Buyer|Seller|Date)\)/g;
// "INITIALS OF BUYER(S): ( )" — one oval per side in OREA page footers, shared by that
// side's signers: Buyer 1 and Buyer 2 go side by side in it. The oval is drawn with curves,
// which pdftext.js doesn't keep, so its place is measured from the label (Form 100, 2024:
// starts 3pt after the colon, 60pt wide, centred 3pt above the baseline).
const INITIALS_OVAL = /\bINITIALS OF (BUYER|SELLER)\(S\):/g;
// Where the date goes: "Signed and dated at ____ m. on ____, 20__", "SIGNED AND DATED on
// ____", "Date ____, 20__".
// Saskatchewan: "SIGNED AND SEALED by the Buyer at ____ on the ____ day of ____, 20__" (the
// "at" is a place, not a time) and "Signed at ____ (on) mm ____ dd ____ yyyy ____".
const DATED = /\bsigned and dated\b.*?\bon(?![a-z])|\bsigned and sealed\b.*?\bday of\b|^\s*Signed at\b.*?\bmm(?![a-ce-z])|^\s*Signed on\b|^\s*Date\b/i;

/** The blocks one page's labels point to: [{type, role, x, y (bottom), w, h, order}]. */
export function pageBlocks(page) {
  const lines = toLines(page.items || []);
  // Dotted or underscored lines typed as text are signing lines too (OREA prints its lines
  // as rows of dots).
  const typed = lines.flatMap((l) => [...l.text.matchAll(/[._]{12,}/g)]
    .map((m) => ({ x1: xAt(l, m.index), x2: xAt(l, m.index + m[0].length), y: l.y })));
  const rules = [...rulesOf(page.shapes), ...typed];
  const boxes = boxesOf(page.shapes);
  const out = [];
  // A signature or date box stops short of text just above it — the row above's labels, a
  // heading — rather than covering it (Saskatchewan's Agency Disclosure: two signing rows
  // 27pt apart; Alberta's purchase contract, printed text close over the lines). Never
  // shorter than 12pt. Only text over the box itself counts, letter by letter: a row's
  // words spread across the page.
  const roomAbove = (x, w, bottom, h) => {
    let top = bottom + h;
    for (const l of lines) {
      const under = l.y - 0.25 * l.size; // the bottom of its letters, descenders included
      if (l.y <= bottom + 2 || under >= top) continue;
      if ([...l.text].some((ch, i) => ch !== " " && ch !== "_" && xAt(l, i) >= x - 2 && xAt(l, i) <= x + w)) top = under;
    }
    return Math.max(12, top - bottom - 1);
  };
  const add = (spec, role, x, bottom, extra = {}) => {
    const h = extra.h ?? spec.h;
    const fit = spec !== INI ? roomAbove(x, extra.w ?? spec.w, bottom, h) : h; // initials are sized already
    out.push({ spec, role, x, y: bottom, ...extra, ...(fit < h ? { h: fit } : {}) });
  };

  for (const line of lines) {
    // Signature labels under a line.
    for (const m of line.text.matchAll(SIGNATURE_LABEL)) {
      const role = ROLE(m[1] || m[2]);
      if (!role) continue;
      const x = xAt(line, m.index), xEnd = xAt(line, m.index + m[0].length);
      // The line can also run on from the label: "Consumer Signature ________" (RECA's
      // Consumer Relationships Guide).
      const r = ruleRight(rules, xEnd, line.y) || ruleAbove(rules, x, xEnd, line.y, line.size);
      add(SIG, role, r ? r.x1 + 2 : x, r ? r.y + 1 : line.y + line.size + 2, { sig: true });
    }
    for (const m of line.text.matchAll(SIGNATURE_CAPS)) {
      const x = xAt(line, m.index), xEnd = xAt(line, m.index + m[0].length);
      const r = ruleRight(rules, xEnd, line.y) || ruleAbove(rules, x, xEnd, line.y, line.size);
      if (r) add(SIG, ROLE(m[1]), r.x1 + 2, r.y + 1, { sig: true });
    }
    // Bare role names under lines.
    if (BARE_ROLES.test(line.text)) {
      for (const m of line.text.matchAll(BARE_SIGNER)) {
        // A name on its own under its line, not part of a label: Alberta's "Buyer Signature
        // Witness Signature" is two labels (SIGNATURE_LABEL has the first, the witness has
        // no role), Saskatchewan's "Witness          Signature" two names a column apart.
        if (!standsAlone(line, m.index, m.index + m[0].length)) continue;
        const x = xAt(line, m.index), xEnd = xAt(line, m.index + m[0].length);
        const r = ruleAbove(rules, x, xEnd, line.y, line.size);
        if (!r) continue; // a name with no line over it is a heading, not a signing line
        add(SIG, bareRole(m[1]), r.x1 + 2, r.y + 1, { sig: true });
      }
    }
    // Ontario rows: a signature on the dotted line over each (Buyer) / (Seller), and the
    // date over the (Date) after it, for that same signer.
    if (PAREN_ROW.test(line.text)) {
      let last = null;
      for (const m of line.text.matchAll(PAREN_ROLE)) {
        const x = xAt(line, m.index), xEnd = xAt(line, m.index + m[0].length);
        const r = ruleAbove(rules, x, xEnd, line.y, line.size);
        const bottom = r ? r.y + 1 : line.y + line.size + 1;
        if (m[1] === "Date") {
          if (last) add(DATE, null, x, bottom, { date: true, pair: last });
          continue;
        }
        add(SIG, ROLE(m[1]), x, bottom, { sig: true, paren: true });
        last = out.at(-1);
      }
    }
    for (const m of line.text.matchAll(INITIALS_OVAL)) {
      const x = xAt(line, m.index + m[0].length) + 4;
      [0, 1].forEach((n) => add(INI, ROLE(m[1]), x + n * 29, line.y - 4, { index: n, w: 27, h: 15 }));
    }
    // Initials on underscore runs.
    for (const m of line.text.matchAll(INITIALS_RUNS)) {
      const role = ROLE(m[1]);
      const runsAt = m.index + m[0].length - m[2].length;
      // One run per signer, in order: the first is Seller 1, the second Seller 2.
      [...m[2].matchAll(/_{4,}/g)].forEach((u, n) => {
        const x = xAt(line, runsAt + u.index), xEnd = xAt(line, runsAt + u.index + u[0].length);
        add(INI, role, x + Math.max(0, (xEnd - x - INI.w) / 2), line.y - 1, { index: n });
      });
    }
    for (const m of line.text.matchAll(INITIALS_UNDER)) {
      const x = xAt(line, m.index), xEnd = xAt(line, m.index + m[0].length);
      const r = ruleAbove(rules, x, xEnd, line.y, line.size);
      if (!r) continue;
      // Two signers on one line: halves of it, narrower than usual if it's short.
      const w = Math.min(INI.w, (r.x2 - r.x1 - 6) / 2);
      [0, 1].forEach((n) => add(INI, ROLE(m[1]), r.x1 + 2 + n * (w + 2), r.y - 1, { index: n, w, h: Math.min(INI.h, 16) }));
    }
    // Initials in a drawn box to the label's left.
    for (const m of line.text.matchAll(INITIALS_BOX)) {
      const role = ROLE(m[1]);
      const x = xAt(line, m.index);
      const box = boxes.find((b) => b.x2 <= x + 2 && b.x2 >= x - 14 && b.y1 <= line.y + 4 && b.y2 >= line.y);
      if (box) add(INI, role, box.x1 + 1, box.y1 + 1, { w: box.x2 - box.x1 - 2, h: box.y2 - box.y1 - 2 });
    }
    // Dates: on the underscores after "on" / "Date", else just after the word.
    const d = DATED.exec(line.text);
    const run = d && /_{4,}/.exec(line.text.slice(d.index + d[0].length));
    // "Date" alone starts a heading too ("Date and Buyer's Signature"); only with a blank.
    if (d && (run || !/^\s*Date$/i.test(d[0]) || /^\s*Date\s*,\s*20/i.test(line.text))) {
      const after = d.index + d[0].length;
      // A drawn line right after the word, when there's no typed one (Saskatchewan's Agency
      // Disclosure: "mm" then a line).
      // Its "mm" can come out glued to the rest ("mmddyyyy"), which puts the end of "mm" in
      // the wrong place: look from where "mm" starts instead.
      const drawn = !run && ruleRight(rules, xAt(line, /mm$/i.test(d[0]) ? after - 2 : after), line.y);
      const x = run ? xAt(line, after + run.index) + 2 : drawn ? drawn.x1 + 2 : xAt(line, after) + 6;
      // A blank of its own for the time ("Signed and dated at ____ .m. on ____", AREA and
      // MREA): time on that one, date-only on the other. Otherwise one Date & Time block
      // carries both (Dan, 2026-10-29).
      const at = /\bsigned and dated\s+at\b/i.exec(line.text);
      if (at) {
        const atEnd = at.index + at[0].length;
        const tRun = /^\s*_{3,}/.exec(line.text.slice(atEnd));
        const tx = tRun ? xAt(line, atEnd + tRun[0].indexOf("_")) + 1 : xAt(line, atEnd) + 4;
        add(TIME, null, tx, line.y - 1, { date: true });
        add(DATE_ONLY, null, x, line.y - 1, { date: true });
      } else add(DATE, null, x, line.y - 1, { date: true });
    }
  }
  return out;
}

// ---------------------------------------------------------------- slots and the layout

/** Number each role's signature lines and initials per page in reading order (top to
 *  bottom, left to right), and give each date the signer whose line is next below it. */
export function assignSlots(blocks) {
  const sorted = [...blocks].sort((a, b) => b.y - a.y || a.x - b.x);
  const seen = {};
  const lastY = {};
  for (const b of sorted) {
    if (b.date || b.index !== undefined) continue;
    const k = `${b.spec.type}|${b.role}`;
    // Ontario's rows come in groups on one page (the offer's, then the acknowledgement's):
    // a gap starts the numbering again, so each group is Seller 1, Seller 2.
    if (b.paren && lastY[k] !== undefined && lastY[k] - b.y > 45) seen[k] = -1;
    b.index = seen[k] = (seen[k] ?? -1) + 1;
    lastY[k] = b.y;
  }
  for (const d of sorted.filter((b) => b.date)) {
    if (d.pair) { d.role = d.pair.role; d.index = d.pair.index; continue; }
    // The nearest row of signature lines below; in it, the leftmost (Seller before Buyer on
    // a form both sign) — a row's lines can sit a point or two apart.
    const below = sorted.filter((s) => s.sig && s.y < d.y && d.y - s.y < 90);
    const top = Math.max(...below.map((s) => s.y));
    const sig = below.filter((s) => top - s.y < 6).sort((a, b) => a.x - b.x)[0];
    if (sig) { d.role = sig.role; d.index = sig.index; }
  }
  return sorted.filter((b) => b.role && b.index !== undefined);
}

/** A form's pages (readPdfText) → {layout, found} for layout.js, or {layout: null} when no
 *  label was recognised. AGENT is a placeholder for "the agent, whichever side": resolve it
 *  with forAgent() before applying. */
export function autoLayout(pages) {
  const fieldDefinitions = [];
  const documentFieldValidations = [];
  const most = {};
  const found = {};
  pages.forEach((page, i) => {
    for (const b of assignSlots(pageBlocks(page))) {
      const w = b.w ?? b.spec.w, h = b.h ?? b.spec.h;
      if (b.y < 0 || b.y + h > page.height + 1 || b.x < 0 || b.x + w > page.width + 1) continue;
      const index = fieldDefinitions.length;
      fieldDefinitions.push({
        index,
        type: b.spec.type,
        signeeType: b.role,
        signeeIndex: b.index,
        formatting: { fontSize: b.spec.fontSize, rotationAngle: 0 },
        fieldLocations: [{ position: [round(b.x), round(b.y), round(b.x + w), round(b.y + h)], pageNum: i + 1 }],
        displayName: `${b.spec.label} ${index + 1}`,
        defaultValue: null,
        readonly: false,
      });
      // Every block is required, dates and times too: Real Signature stamps a date or time
      // only when the signer clicks it, and an optional one left alone stays blank on the
      // signed copy (Dan's test packet, 2026-10-29). Required, the signer can't finish
      // without it — as with the agents' imported templates.
      documentFieldValidations.push({ validationType: "REQUIRED", fieldIndex: index, relatedFieldIndexes: [] });
      most[b.role] = Math.max(most[b.role] || 0, b.index + 1);
      found[b.spec.type] = (found[b.spec.type] || 0) + 1;
    }
  });
  if (!fieldDefinitions.length) return { layout: null, found };
  return {
    layout: {
      pagesCount: pages.length,
      fieldDefinitions,
      documentFieldValidations,
      signeeConfigs: Object.entries(most).map(([signeeType, maxNum]) => ({ signeeType, minNum: 0, maxNum })),
    },
    found,
  };
}

const AGENT_TYPES = ["AGENT", "BUYERS_AGENT", "SELLERS_AGENT"];

/** Agent blocks for the agent who's signing (agentRole: BUYERS_AGENT / SELLERS_AGENT, or
 *  null when no agent signs): the generic "Brokerage Representative" lines become theirs,
 *  the other side's agent lines come off — that agent signs through their own brokerage. */
export function forAgent(layout, agentRole) {
  if (!layout) return layout;
  const keep = layout.fieldDefinitions
    .filter((f) => !AGENT_TYPES.includes(f.signeeType) || (agentRole && (f.signeeType === "AGENT" || f.signeeType === agentRole)))
    .map((f) => (f.signeeType === "AGENT" ? { ...f, signeeType: agentRole } : f));
  const map = new Map();
  const fieldDefinitions = keep.map((f, i) => { map.set(f.index, i); return { ...f, index: i }; });
  const documentFieldValidations = layout.documentFieldValidations
    .filter((v) => map.has(v.fieldIndex)).map((v) => ({ ...v, fieldIndex: map.get(v.fieldIndex) }));
  const most = {};
  for (const f of fieldDefinitions) most[f.signeeType] = Math.max(most[f.signeeType] || 0, f.signeeIndex + 1);
  return {
    ...layout,
    fieldDefinitions,
    documentFieldValidations,
    signeeConfigs: Object.entries(most).map(([signeeType, maxNum]) => ({ signeeType, minNum: 0, maxNum })),
  };
}

const round = (v) => Math.round(v * 10) / 10;

/** Every signer the counts ask for gets a role, with or without a line on this form — the
 *  same signers as No template would set up (configsFromCounts in draft.js). */
export function withSigners(layout, counts) {
  const configs = new Map(layout.signeeConfigs.map((c) => [c.signeeType, { ...c }]));
  for (const [type, n] of Object.entries(counts || {})) {
    if (!n) continue;
    const c = configs.get(type);
    configs.set(type, c ? { ...c, maxNum: Math.max(c.maxNum ?? 0, n) } : { signeeType: type, minNum: 0, maxNum: n });
  }
  return { ...layout, signeeConfigs: [...configs.values()] };
}

/** "Consumer" lines (RECA's Consumer Relationships Guide) belong to the agent's own clients:
 *  the side that signs. Only one side signing says which; with both (or neither) nothing
 *  does, so those blocks come off and the agent places them. Slots past the side's count
 *  come off too, as dropUnusedSlots does for buyers and sellers. */
export function forClients(layout, counts) {
  if (!layout) return layout;
  const sides = ["BUYER", "SELLER"].filter((s) => (counts?.[s] ?? 0) > 0);
  const side = sides.length === 1 ? sides[0] : null;
  const keep = layout.fieldDefinitions
    .filter((f) => f.signeeType !== "CLIENT" || (side && f.signeeIndex < counts[side]))
    .map((f) => (f.signeeType === "CLIENT" ? { ...f, signeeType: side } : f));
  const map = new Map();
  const fieldDefinitions = keep.map((f, i) => { map.set(f.index, i); return { ...f, index: i }; });
  const most = {};
  for (const f of fieldDefinitions) most[f.signeeType] = Math.max(most[f.signeeType] || 0, f.signeeIndex + 1);
  return {
    ...layout,
    fieldDefinitions,
    documentFieldValidations: layout.documentFieldValidations
      .filter((v) => map.has(v.fieldIndex)).map((v) => ({ ...v, fieldIndex: map.get(v.fieldIndex) })),
    signeeConfigs: Object.entries(most).map(([signeeType, maxNum]) => ({ signeeType, minNum: 0, maxNum })),
  };
}

/** What placing would give a form, for the panel's choices before any draft exists
 *  (the PDF stays in the background): how many blocks, and whether any are the agent's. */
export function placedSummary(layout) {
  const f = layout?.fieldDefinitions || [];
  return { blocks: f.length, agent: f.some((x) => AGENT_TYPES.includes(x.signeeType)) };
}

/** Why a form placed from its labels got no blocks, as a code for an error report (no text
 *  leaves: report.js). Read failures come in as the error; otherwise the text itself says:
 *  "no-text" (scanned pages, nothing to read), "fonts" (text that isn't words: fonts we
 *  can't map to letters, as on one Manitoba form), or "no-labels" (readable, but no label
 *  we know — usually a province or form not done yet). null: blocks were placed. */
export function placeOutcome({ pages = null, error = null, blocks = 0 }) {
  if (error) return /password/i.test(String(error?.message || error)) ? "pdf-locked" : "pdf-unreadable";
  if (blocks > 0) return null;
  const text = (pages || []).flatMap((p) => p.items.map((i) => i.str)).join(" ");
  if (!text.trim()) return "no-text";
  // Every form has these (English or French). Garbled fonts give letters, but not words.
  const words = (text.match(/\b(the|and|of|to|le|la|les|de|et)\b/gi) || []).length;
  return words < 5 ? "fonts" : "no-labels";
}
