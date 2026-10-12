// Matching a WEBForms transaction to a reZEN deal, and the wrong-deal guard.
// A TC works across every agent's deals, so attaching a contract to the wrong deal is the
// most likely real mistake. We RANK and WARN; the person always picks.

const ABBREV = {
  AVENUE: "AVE", STREET: "ST", ROAD: "RD", DRIVE: "DR", BOULEVARD: "BLVD", CRESCENT: "CRES",
  COURT: "CRT", PLACE: "PL", TRAIL: "TRL", TERRACE: "TERR", CLOSE: "CL", LANE: "LN",
  NORTHWEST: "NW", NORTHEAST: "NE", SOUTHWEST: "SW", SOUTHEAST: "SE",
};

/** Hand-typed addresses carry stray tabs, double spaces, unit prefixes and spelled-out
 *  street types. Normalise before comparing. */
export function normalizeAddress(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/\./g, "")          // N.W. → NW, not "N W"
    .replace(/[#,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => ABBREV[w] || w)
    .join(" ");
}

function tokens(addr) {
  return normalizeAddress(addr).split(" ").filter(Boolean);
}

/** 0..1: civic number must agree (a different house is a different deal), then the share
 *  of the rest of the words in common. */
export function addressScore(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  const numsA = A.filter((t) => /^\d+[A-Z]?$/.test(t));
  const numsB = B.filter((t) => /^\d+[A-Z]?$/.test(t));
  if (numsA.length && numsB.length && !numsA.some((n) => numsB.includes(n))) return 0;
  const setB = new Set(B);
  const words = A.filter((t) => !numsA.includes(t));
  if (!words.length) return numsA.length ? 0.5 : 0;
  const hit = words.filter((w) => setB.has(w)).length;
  return 0.5 + 0.5 * (hit / words.length);
}

/** Deals best-first for a WEBForms transaction name/address. Every deal is returned —
 *  the picker shows all, ranked — so a bad match never hides the right one. */
export function rankDeals(webformsAddress, deals) {
  return deals
    .map((d) => ({ deal: d, score: addressScore(webformsAddress, d.address || "") }))
    .sort((x, y) => y.score - x.score);
}

/** Which side the deal's agent represents: "BUYER", "SELLER", "DUAL" or null (unknown).
 *  The deal LIST carries no buySide/listingSide flags; the owner's `represents` string does:
 *  "Buy Side Representation" / "Listing Side Representation" (all 27 open deals checked,
 *  2026-10-11; no dual one was open, so "dual" is matched loosely). A listing is the
 *  seller's side by definition. */
export function representedSide(t, { listing = false } = {}) {
  const r = String(t.transactionOwner?.represents ?? "").toLowerCase();
  if (/dual|both/.test(r) || (/buy/.test(r) && /list|sell/.test(r))) return "DUAL";
  if (/buy/.test(r)) return "BUYER";
  if (/list|sell/.test(r)) return "SELLER";
  return listing ? "SELLER" : null;
}

/** arrakis deal → what the picker and the draft need. Hand-typed fields carry stray
 *  whitespace (a TAB before an MLS number has been seen), so trim everything. */
export function summarizeDeal(t, { listing = false } = {}) {
  const trim = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  return {
    id: t.id,
    kind: listing ? "listing" : "deal",
    side: representedSide(t, { listing }),
    address: trim(t.address?.oneLine),
    agentName: trim(t.transactionOwner?.name),
    ownerId: t.transactionOwner?.id ?? null,
    mlsNum: trim(t.mlsNum),
    participants: (t.participants || []).map((p) => ({
      role: p.participantRole,
      firstName: trim(p.firstName),
      lastName: trim(p.lastName),
      email: trim(p.emailAddress),
    })),
  };
}

/** Warnings to show before creating the draft. Empty array = nothing to flag. */
export function wrongDealWarnings({ webformsAddress, webformsAgentName, deal }) {
  const out = [];
  if (webformsAddress && addressScore(webformsAddress, deal.address || "") < 0.75) {
    out.push("The WEBForms address doesn't match this deal's address.");
  }
  if (webformsAgentName && deal.agentName
      && normalizeAddress(webformsAgentName) !== normalizeAddress(deal.agentName)) {
    out.push(`These forms are in ${webformsAgentName}'s WEBForms account, but the deal belongs to ${deal.agentName}.`);
  }
  return out;
}
