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

test("another site's tab gets nothing added", async () => {
  const calls = fakeChrome({ url: "https://example.com/" });
  await assert.rejects(sendToTab(7, { type: "x" }), /reload this tab once/);
  assert.deepEqual(calls.inject, []);
});
