// Release checklist step 3: every sample form's Auto place blocks, last release vs this one.
//   node dev/compare-forms.mjs <old checkout> <new checkout> <sample forms folder>
// e.g. a `git worktree add` of the last tag, the release branch, and
// C:\Users\dan\dotted-line-test-forms (/mnt/c/...). Prints each form whose blocks differ,
// block by block (type, signer, page, position), so a moved block shows as well as a new
// one. The forms folder holds real client PDFs: never commit this script's output.
// (Kept here since 2026-11-18: the scratchpad copy it replaces was lost to a cleanup.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
const [oldRepo, newRepo, dir] = process.argv.slice(2);
const load = async (r) => ({
  read: (await import(pathToFileURL(join(r, "src/lib/pdftext.js")))).readPdfText,
  auto: (await import(pathToFileURL(join(r, "src/lib/autoplace.js")))).autoLayout,
});
const A = await load(oldRepo), B = await load(newRepo);
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.pdf$/i.test(f) ? [p] : []; });
const sig = async (L, bytes) => {
  let pages; try { pages = await L.read(new Uint8Array(bytes)); } catch { return ["unreadable"]; }
  const l = L.auto(pages).layout;
  return (l?.fieldDefinitions || []).map((f) => `${f.type} ${f.signeeType}${f.signeeIndex} p${f.fieldLocations[0].pageNum} ${f.fieldLocations[0].position.map(Math.round).join(",")}`).sort();
};
let n = 0, changed = 0;
for (const f of walk(dir)) {
  n++;
  const bytes = readFileSync(f);
  const a = await sig(A, bytes), b = await sig(B, bytes);
  if (a.join("|") === b.join("|")) continue;
  changed++;
  console.log(`\n== ${relative(dir, f)}`);
  for (const x of a) if (!b.includes(x)) console.log(`  - ${x}`);
  for (const x of b) if (!a.includes(x)) console.log(`  + ${x}`);
}
console.log(`\n${n} forms, ${changed} changed`);
