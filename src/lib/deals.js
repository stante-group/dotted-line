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
    .map((w) => ABBREV[w] || w.replace(/^(\d+)(ST|ND|RD|TH)$/, "$1"))   // 9TH AVE = 9 AVE
    .join(" ");
}

function tokens(addr) {
  return normalizeAddress(addr).split(" ").filter(Boolean);
}

/** Street types, as normalizeAddress writes them. */
const STREET_TYPES = new Set([...Object.values(ABBREV).filter((v) => !/^[NS][EW]$/.test(v)), "AVE", "ST"]);

/** The civic numbers in an address's words: every number except a numbered street's own
 *  ("9" in "120 9 AVE SE"). Calgary's numbered avenues and streets put the street's number
 *  right after the civic one, and counting it as a civic number made every deal on 9 Ave SE
 *  "the same house": two deals tied and none was picked (2026-10-31). */
function civicNumbers(T) {
  return T.filter((t, i) => /^\d+[A-Z]?$/.test(t) && !STREET_TYPES.has(T[i + 1]));
}

/** 0..1: civic number must agree (a different house is a different deal), then the share
 *  of the rest of the words in common. */
export function addressScore(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  const numsA = civicNumbers(A);
  const numsB = civicNumbers(B);
  if (numsA.length && numsB.length && !numsA.some((n) => numsB.includes(n))) return 0;
  const setB = new Set(B);
  const words = A.filter((t) => !numsA.includes(t));
  if (!words.length) return numsA.length ? 0.5 : 0;
  const hit = words.filter((w) => setB.has(w)).length;
  return 0.5 + 0.5 * (hit / words.length);
}

/** 0..1: how well a deal's street address shows up somewhere in a form's text — for a PDF
 *  uploaded in Real Signature, where no WEBForms deal names the address. Picking the address
 *  out of a form is guesswork (every form lays it out differently); looking for each deal's
 *  own address in the text isn't. Only the street part (before the first comma): the city
 *  and postal code are on every deal. Each place the civic number appears is scored with
 *  the words just around it, so a price or a date with the same digits scores nothing
 *  without the street name beside it. */
export function addressInText(address, text) {
  const split = (s) => normalizeAddress(String(s || "").replace(/(\d)-(?=\d)/g, "$1 ").replace(/[^\w\s#.,-]/g, " ")).split(" ").filter(Boolean);
  const street = split(String(address || "").split(",")[0]);
  const nums = street.filter((t) => /^\d+[A-Z]?$/.test(t));
  if (!nums.length) return 0;
  const T = split(text);
  let best = 0;
  T.forEach((t, i) => {
    if (nums.includes(t)) best = Math.max(best, addressScore(street.join(" "), T.slice(Math.max(0, i - 3), i + 8).join(" ")));
  });
  return best;
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
    // A client can be a company: reZEN then has its name in `company` and no first or last
    // name (2026-10-31: a buyer like that went to Real Signature with a blank name, and it
    // refused the whole packet). The company's name is the signer's name.
    participants: (t.participants || []).map((p) => ({
      role: p.participantRole,
      firstName: trim(p.firstName),
      lastName: trim(p.lastName),
      company: trim(p.company),
      email: trim(p.emailAddress),
    })),
  };
}

/** Whether a draft's `defaults.transactionId` may be a Buyer Record's id. No: Real
 *  Signature's own Transaction step doesn't list Buyer Records (Dan, 2026-10-14), so the
 *  draft takes its buyers from the record and stays unattached until "Mark In Contract"
 *  makes a transaction. Flip only if Real Signature starts offering them. */
export const BUYER_RECORDS_ATTACH = false;

/** arrakis GET /buyer-record/{id} → the same shape as summarizeDeal, kind "buyer". Its
 *  clients are external participants (with emails); agents and TCs are internal (no email
 *  here), so only the clients become participants. No address: a buyer before contract has
 *  no property yet. */
export function summarizeBuyerRecord(r) {
  if (!r || typeof r.id !== "string" || !Array.isArray(r.participants)) throw new Error("reZEN's Buyer Record changed shape");
  const trim = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const clients = r.participants.map((p) => p.externalParticipant).filter(Boolean);
  const owner = r.participants.map((p) => p.internalParticipant).find((p) => p?.owner);
  return {
    id: r.id,
    kind: "buyer",
    side: "BUYER",
    address: "",
    code: trim(r.code),
    agentName: owner ? trim(`${owner.firstName ?? ""} ${owner.lastName ?? ""}`) : "",
    ownerId: owner?.userId ?? null,
    mlsNum: "",
    buyerNames: clients.filter((p) => p.role === "BUYER")
      .map((p) => trim(p.entityName) || trim(`${p.firstName ?? ""} ${p.lastName ?? ""}`)).filter(Boolean),
    participants: clients.map((p) => ({
      role: p.role,
      firstName: trim(p.firstName),
      lastName: trim(p.lastName),
      company: trim(p.entityName),
      email: trim(p.emailAddress),
    })),
  };
}

const nameWords = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length > 1 && !["and", "ltd", "inc"].includes(w));

/** Does a Buyer Record's buyer appear among the names typed in WEBForms? Every word of one
 *  of its buyers' names (first and last) must be on one typed line, so a couple typed as
 *  "Jordan & Riley Sample" matches "Jordan Sample", and a shared surname alone doesn't. */
export function matchesBuyerNames(typedLines, record) {
  const lines = (typedLines || []).map((l) => new Set(nameWords(l)));
  return (record.buyerNames || []).some((n) => {
    const words = nameWords(n);
    return words.length > 0 && lines.some((l) => words.every((w) => l.has(w)));
  });
}

/** Warnings to show before creating the draft. Empty array = nothing to flag. */
export function wrongDealWarnings({ webformsAddress, webformsAgentName, deal }) {
  const out = [];
  // A Buyer Record has no address to compare (there's no property yet).
  if (webformsAddress && deal.kind !== "buyer" && addressScore(webformsAddress, deal.address || "") < 0.75) {
    out.push("The WEBForms address doesn't match this deal's address.");
  }
  if (webformsAgentName && deal.agentName
      && normalizeAddress(webformsAgentName) !== normalizeAddress(deal.agentName)) {
    out.push(`These forms are in ${webformsAgentName}'s WEBForms account, but the deal belongs to ${deal.agentName}.`);
  }
  return out;
}
