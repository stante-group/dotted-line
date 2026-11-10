import { test } from "node:test";
import assert from "node:assert/strict";
import { isBare400, refusalMessage, whoFromType } from "../src/lib/refusal.js";
import { classifyError, errorReport } from "../src/lib/report.js";

test("a bare 400 on a read is caught; a 400 that says why, a write, or another status is not", () => {
  assert.ok(isBare400("GET /document-templates → 400: Bad Request"));
  assert.ok(isBare400("GET /one-time-templates → 400"));
  assert.ok(isBare400("GET /transactions/participant/abc/listing-transactions/OPEN → 400: Bad Request"));
  assert.ok(!isBare400("GET /document-templates → 400: page: must be greater than or equal to 0"));
  assert.ok(!isBare400("PUT /document-templates/abc → 400: Bad Request"));
  assert.ok(!isBare400("GET /document-templates → 403"));
  assert.ok(!isBare400("Real Signature didn't answer in 60 seconds. Try again in a minute"));
});

test("the profile type picks the words", () => {
  assert.equal(whoFromType("AGENT"), "agent");
  assert.equal(whoFromType("agent"), "agent");
  assert.equal(whoFromType("BROKER"), "not-agent");
  assert.equal(whoFromType(null), "unknown");
});

for (const [who, code] of [["agent", "account-refused"], ["unknown", "account-refused"],
  ["acting", "account-refused"], ["not-agent", "not-agent-account"]]) {
  test(`${who}: the report keeps route, status and reason, and says ${code}`, () => {
    const msg = refusalMessage("GET /document-templates → 400: Bad Request", who);
    assert.match(msg, /Nothing was made or sent\./);
    const c = classifyError(new Error(msg));
    assert.equal(c.code, code);
    assert.equal(c.status, 400);
    assert.equal(c.route, "GET /document-templates");
    assert.equal(c.reason, "status-text");
    assert.equal(c.cls, "rejected");
    assert.equal(c.site, "real-signature");
  });
}

test("the explained error still makes a valid report with nothing but fixed choices", () => {
  const r = errorReport({ error: new Error(refusalMessage("GET /one-time-templates → 400: Bad Request", "not-agent")),
    step: "on-draft", version: "0.4.0", chrome: "156" });
  assert.equal(r.code, "not-agent-account");
  assert.ok(!JSON.stringify(r).includes("Whose documents"));
});
