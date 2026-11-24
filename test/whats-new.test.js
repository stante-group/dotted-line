// The "What's new" note after an update (GitHub #8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { WHATS_NEW } from "../src/whats-new.js";
import { WHATS_NEW_KEY, unseenAfterInstall, noteToShow } from "../src/lib/whats-new-note.js";

const notes = { "0.4.0": "Something you'd notice." };

test("an update to a version with a note stores it as unseen", () => {
  assert.equal(unseenAfterInstall({ reason: "update", previousVersion: "0.3.1" }, "0.4.0", notes), "0.4.0");
});

test("a fresh install, Chrome's own update, or a same-version reload store nothing", () => {
  assert.equal(unseenAfterInstall({ reason: "install" }, "0.4.0", notes), undefined);
  assert.equal(unseenAfterInstall({ reason: "chrome_update", previousVersion: "0.3.1" }, "0.4.0", notes), undefined);
  // An unpacked test copy fires "update" on every reload, with the same version.
  assert.equal(unseenAfterInstall({ reason: "update", previousVersion: "0.4.0" }, "0.4.0", notes), undefined);
  assert.equal(unseenAfterInstall(undefined, "0.4.0", notes), undefined);
});

test("a fixes-only version (no entry) stores nothing, so an earlier unseen note stays", () => {
  assert.equal(unseenAfterInstall({ reason: "update", previousVersion: "0.4.0" }, "0.4.1", notes), undefined);
  assert.equal(unseenAfterInstall({ reason: "update", previousVersion: "0.4.0" }, "0.4.1", { "0.4.1": "  " }), undefined);
});

test("the panel shows a note only for an unseen version that has one", () => {
  assert.deepEqual(noteToShow("0.4.0", notes), { version: "0.4.0", text: "Something you'd notice." });
  assert.equal(noteToShow(undefined, notes), null, "seen (removed) or never set");
  assert.equal(noteToShow("0.4.1", notes), null, "no entry: nothing");
  assert.equal(noteToShow("toString", notes), null, "not fooled by Object's own properties");
  assert.equal(noteToShow({}, notes), null);
});

test("every entry is a dotted version and one or two sentences of plain text", () => {
  for (const [v, text] of Object.entries(WHATS_NEW)) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `${v}: manifest versions only, never a version_name label`);
    assert.equal(typeof text, "string");
    assert.ok(text.trim().length > 0 && text.length <= 300, `${v}: one or two sentences`);
    // Plain text: no markup, no entities, no links (the panel's own "All changes" is the link).
    assert.doesNotMatch(text, /[<>]|&[#\w]+;|https?:|javascript:/i, `${v} looks like markup`);
    const sentences = text.split(/[.!?](?:\s|$)/).filter((s) => s.trim());
    assert.ok(sentences.length <= 2, `${v} has ${sentences.length} sentences`);
  }
});

test("the panel puts the note in with textContent, never as HTML", () => {
  const panel = readFileSync(new URL("../src/panel/panel.js", import.meta.url), "utf8");
  const fn = /async function showWhatsNew\(\) \{[\s\S]*?\n\}/.exec(panel)?.[0];
  assert.ok(fn, "showWhatsNew is in panel.js");
  assert.match(fn, /\$\("whats-new-text"\)\.textContent = /);
  assert.doesNotMatch(fn, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.equal(WHATS_NEW_KEY, "whatsNew");
});

test("the worker stores it on an update and a draft made marks it seen", () => {
  const bg = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  assert.match(bg, /chrome\.runtime\.onInstalled\.addListener\(\(details\) => \{\n  const v = unseenAfterInstall\(details, chrome\.runtime\.getManifest\(\)\.version, WHATS_NEW\);/);
  assert.match(bg, /function recordOk\(\{ path, forms, labels = false \}\) \{\n[^\n]*\n  chrome\.storage\.local\.remove\(WHATS_NEW_KEY\)/);
});
