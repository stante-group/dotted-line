// Run on a store zip before it's uploaded:  node dev/check-store-zip.mjs <zip>
//
// Passes only if the zip holds nothing but manifest.json, src/ and icons/, nothing in it
// mentions the test WEBForms page, and every file is byte-for-byte the repo's (so check out
// the release commit first). A test copy's patched panel or worker can't pass.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { unzip } from "../src/lib/unzip.js";

const zipPath = process.argv[2];
if (!zipPath) { console.error("usage: node dev/check-store-zip.mjs <zip>"); process.exit(2); }
const root = new URL("..", import.meta.url).pathname;
const MENTIONS = /dev\/|sim-hooks|webforms\.html|DEV-SIM|devsim/;

const problems = [];
const entries = (await unzip(new Uint8Array(readFileSync(zipPath)))).filter((e) => !e.name.endsWith("/"));
for (const { name, data } of entries) {
  if (!(name === "manifest.json" || name.startsWith("src/") || name.startsWith("icons/"))) problems.push(`${name}: not part of the extension`);
  if (!/\.(png|jpg|ico)$/i.test(name) && MENTIONS.test(new TextDecoder().decode(data))) problems.push(`${name}: mentions the test page`);
  const mine = join(root, name);
  if (!existsSync(mine)) problems.push(`${name}: not in the repo`);
  else if (!Buffer.from(data).equals(readFileSync(mine))) problems.push(`${name}: differs from the repo's`);
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`ok: ${entries.length} files, all the repo's own, no test page`);
