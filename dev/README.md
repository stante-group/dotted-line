# dev/: test copies only

Nothing here ships. The store zip is `manifest.json`, `src/` and `icons/`; nothing in
those refers to this folder, and `test/dev-guard.test.js` fails if anything does.

## The test WEBForms page

A page that stands in for a WEBForms deal, so any PDF can go through the real hand-off:
deal match, one-click, Auto place and a Real Signature draft. Add PDFs, tick them, fill in
the deal, and click the Dotted Line icon on that tab.

- It stands in for the WEBForms side only (which forms are ticked, the deal's details, the
  download). Everything after that is the extension's own code.
- The draft is real, in the signed-in Real Signature account. Use invented signers, pick
  No deal for test files, and delete the draft afterwards.
- PDFs stay in the extension's own storage in that browser. Never commit one.

## Making a test copy

```
robocopy \\wsl.localhost\Ubuntu\home\dan\dotted-line C:\Users\dan\dotted-line-dev /MIR /XD .git node_modules /NJH /NJS /NDL /NP
node \\wsl.localhost\Ubuntu\home\dan\dotted-line\dev\apply.mjs C:\Users\dan\dotted-line-dev "0.2.1 (test 41)"
```

`apply.mjs` wires the page into the copy's panel, worker and Settings page (a link under
"Test WEBForms"), and sets `version_name`. It refuses a copy that's already wired, and
stops without writing if the lines it edits have moved (`npm test` catches that first).

## Comparing the sample forms (release step 3)

```
node dev/compare-forms.mjs <last release checkout> <release checkout> /mnt/c/Users/dan/dotted-line-test-forms
```

Lists each sample form whose Auto place blocks differ, block by block. The forms are real
client PDFs: read the output here, never commit or paste it anywhere public.

## Before uploading a store zip

```
node dev/check-store-zip.mjs dotted-line-<version>.zip
```

It passes only if the zip is manifest, src and icons, byte-for-byte the repo's.
