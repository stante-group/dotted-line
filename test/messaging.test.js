import test from "node:test";
import assert from "node:assert/strict";

// A fake Chrome: a tab whose content script answers only once it has been added.
function fakeChrome({ url = "https://pr.transactiondesk.com/forms/1", listening = false, injectOk = true } = {}) {
  const calls = { inject: [] };
  globalThis.chrome = {
    tabs: {
      sendMessage: async () => { if (!listening) throw new Error("Could not establish connection. Receiving end does not exist."); return { ok: true }; },
      get: async () => ({ id: 7, url, status: "complete" }),
    },
    runtime: { getManifest: () => ({ content_scripts: [
      { matches: ["https://pr.transactiondesk.com/*"], js: ["src/webforms/content.js"] },
      { matches: ["https://signature.therealbrokerage.com/*"], js: ["src/realsig/content.js"] },
    ] }) },
    scripting: { executeScript: async ({ target, files }) => {
      calls.inject.push([target.tabId, ...files]);
      if (!injectOk) throw new Error("Cannot access contents of the page");
      listening = true;
    } },
  };
  return calls;
}

const { sendToTab } = await import("../src/messaging.js");

test("a tab opened before the extension was installed gets its script added, and answers", async () => {
  const calls = fakeChrome();
  assert.deepEqual(await sendToTab(7, { type: "x" }), { ok: true });
  assert.deepEqual(calls.inject, [[7, "src/webforms/content.js"]]);
});

test("Real Signature's tab gets Real Signature's script", async () => {
  const calls = fakeChrome({ url: "https://signature.therealbrokerage.com/one-time-documents/x" });
  await sendToTab(7, { type: "x" });
  assert.deepEqual(calls.inject, [[7, "src/realsig/content.js"]]);
});

test("a tab that answers is never given a second copy", async () => {
  const calls = fakeChrome({ listening: true });
  await sendToTab(7, { type: "x" });
  assert.deepEqual(calls.inject, []);
});

test("when the script can't be added, the agent is asked to save, then reload", async () => {
  fakeChrome({ injectOk: false });
  await assert.rejects(sendToTab(7, { type: "x" }), /^Error: Save your changes on this page, then reload this tab once/);
});

test("another site's tab gets nothing added, and no advice to reload", async () => {
  const calls = fakeChrome({ url: "https://example.com/" });
  await assert.rejects(sendToTab(7, { type: "webforms:zip" }), (e) => /has left WEBForms/.test(e.message) && !/reload/.test(e.message));
  assert.deepEqual(calls.inject, []);
});

// Signed out, Real Signature's tab goes to Real's sign-in page on another site, whose
// address Chrome doesn't give us (no url). One click then hit "reload this tab once"
// (0.3.0, 2026-11-01). It's a sign-in, and says so.
test("a Real Signature tab that went to sign in says sign in, as NotSignedIn", async () => {
  const calls = fakeChrome({ url: null });
  await assert.rejects(sendToTab(7, { type: "rs:context" }), (e) =>
    e.name === "NotSignedIn" && /Sign in to Real Signature/.test(e.message) && !/reload/.test(e.message));
  assert.deepEqual(calls.inject, []);
});

test("a signed-out tab's error is reported as signed-out, not a stale tab", async () => {
  fakeChrome({ url: null });
  const e = await sendToTab(7, { type: "rs:context" }).catch((x) => x);
  const { errorReport } = await import("../src/lib/report.js");
  const r = errorReport({ error: e, step: "one-click", version: "0.3.1", chrome: "130" });
  assert.equal(r.cls, "signed-out");
  assert.notEqual(r.code, "stale-tab");
});

// Signed out, Real Signature's script took the question and THEN the page went to sign in:
// Chrome's "message channel closed" (Dan's test, 0.3.1 store copy, 2026-11-08, report 66).
function closedChannel(url, { gone = false } = {}) {
  globalThis.chrome = {
    tabs: {
      sendMessage: async () => { throw new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"); },
      get: async () => (gone ? Promise.reject(new Error("No tab with id: 7")) : { id: 7, url, status: "complete" }),
    },
    runtime: { getManifest: () => ({ content_scripts: [
      { matches: ["https://signature.therealbrokerage.com/*"], js: ["src/realsig/content.js"] },
    ] }) },
    scripting: { executeScript: async () => { throw new Error("should not inject"); } },
  };
}

test("a tab sent to sign in mid-answer says sign in, as NotSignedIn, reported as signed-out", async () => {
  closedChannel(null);
  const e = await sendToTab(7, { type: "rs:context" }).catch((x) => x);
  assert.equal(e.name, "NotSignedIn");
  assert.match(e.message, /Sign in to Real Signature/);
  const { errorReport } = await import("../src/lib/report.js");
  assert.equal(errorReport({ error: e, step: "one-click", version: "0.3.1", chrome: "157" }).cls, "signed-out");
});

test("a closed channel on a tab still on Real Signature, or closed, keeps Chrome's error", async () => {
  closedChannel("https://signature.therealbrokerage.com/home/draft");
  await assert.rejects(sendToTab(7, { type: "rs:context" }), (e) => e.name !== "NotSignedIn" && /channel closed/.test(e.message));
  closedChannel(null, { gone: true });
  await assert.rejects(sendToTab(7, { type: "rs:context" }), (e) => e.name !== "NotSignedIn" && /channel closed/.test(e.message));
});

test("a closed channel while making the draft is never taken for a sign-in", async () => {
  closedChannel(null);
  await assert.rejects(sendToTab(7, { type: "rs:create" }), (e) => e.name !== "NotSignedIn" && /channel closed/.test(e.message));
});
