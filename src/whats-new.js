// What the panel says once, after Chrome updates Dotted Line to a version (GitHub #8).
// Version → one or two plain sentences for an agent, drafted from CHANGELOG.md.
//
// REWRITTEN AT RELEASE TIME, from that version's CHANGELOG section, with the version bump.
// Give a version an entry only if an agent would notice the change. A version with fixes
// only gets none, and then the panel shows nothing after that update.
//
// Plain text only: the panel puts it in with textContent, so markup would show as written,
// and test/whats-new.test.js fails on anything that looks like it.

export const WHATS_NEW = {
  // Drafted from "Not released yet" on 2026-11-09. Rewrite it when 0.4.0 is dated.
  "0.4.0": "Signing in to Real Signature partway through a draft no longer shows an error. Your forms wait while you sign in.",
};
