// Who is acting, and for whom — the framework for Phase 0 item 7 (TC delegation).
//
// A transaction coordinator makes drafts on other agents' deals. Three identities can
// differ, and each mismatch means something different:
//   - the Real Signature sign-in (`me`, yenta users/me) — whose Drafts list it lands in;
//   - the deal's owner (arrakis `transactionOwner`) — whose deal it is;
//   - the WEBForms sign-in (`UserName`) — whose forms these are (or who is impersonating).
//
// TC DELEGATION — verified with a TC at her own computer, 2026-10-15
// (docs/tc-delegation-test.md):
//   - An agent switches on "Real Signature" for a TC in reZEN (Agent Profile → Transaction
//     Coordinators → Manage → the TC → Access Permissions). The TC then picks the agent in
//     Real Signature ("Whose documents would you like to access?" → "Acting as …").
//   - Real keeps that choice in the `actingAsUserId` cookie and sends it as the
//     X-Agent-Context header on every call (realsig-api.js). With it, templates, deals and
//     drafts are the AGENT's: the draft lands in the agent's Drafts and Real's own Review
//     page says the agent "remain[s] the sender of record". So `me` IS the agent while she
//     acts (content.js), and the sender is simply the agent's own name and email.
//   - The TC has no reZEN profile of her own (/users/me → 404) and may not read the
//     agent's (/users/{id} → 403): the agent's name and email come from their deals.
//   - `defaults.sender.agentYentaId` was never needed; it stays null.
//   - WEBForms' UserName while impersonating = the impersonated agent (2026-10-12).

export const DELEGATION_VERIFIED = true;

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** yenta users/me → the few fields we use. */
export function meFromYenta(u) {
  if (!u || typeof u.id !== "string") throw new Error("Real Signature's user details changed shape");
  return {
    id: u.id,
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    fullName: u.fullName || [u.firstName, u.lastName].filter(Boolean).join(" "),
    email: u.emailAddress ?? "",
    type: u.type ?? null,
  };
}

/** The agent a TC is acting for, from that agent's open deals and listings (arrakis
 *  `transactionOwner {id, name, emailAddress}`): a TC may not read the agent's reZEN
 *  profile (/users/{id} → 403, 2026-10-15). An agent with no deal of their own is refused —
 *  never guessed, since the agent's email decides who signs as the agent. */
export function meFromDeals(rawDeals, agentId) {
  const o = (rawDeals || []).map((t) => t?.transactionOwner).find((x) => x?.id === agentId && x.emailAddress);
  if (!o) throw new Error("Couldn't find the agent you're acting for on their open deals (it needs at least one deal of their own in reZEN) — ask them to prepare this draft");
  const fullName = String(o.name ?? "").replace(/\s+/g, " ").trim();
  const [firstName = "", ...rest] = fullName.split(" ");
  return { id: o.id, firstName, lastName: rest.join(" "), fullName, email: String(o.emailAddress).trim(), type: "AGENT" };
}

/** The draft's `defaults.sender`. Same as Real's own UI: the signed-in agent, or — for a
 *  TC acting for an agent — that agent (Real names them sender of record itself). */
export function senderFor(me /*, deal */) {
  return { firstName: me.firstName, lastName: me.lastName, email: me.email, agentYentaId: null };
}

export function isOthersDeal(me, deal) {
  return !!(deal && deal.ownerId && me && deal.ownerId !== me.id);
}

/** Is the WEBForms user the same person as the Real Signature user? By EMAIL only →
 *  true / false, or null when either side has no email (can't tell).
 *  Names are never enough: the systems spell them differently ("Dan …" in WEBForms,
 *  "Daniel …" in Real, 2026-10-12), and real estate runs in families — a father and son on
 *  one team can share a name (Dan, 2026-10-12: "stick with email matching and flag any
 *  mismatches"). While impersonating, WEBForms' email is the teammate's, so this is false. */
export function samePerson({ wfEmail, rsEmail }) {
  if (!wfEmail || !rsEmail) return null;
  return norm(wfEmail) === norm(rsEmail);
}

// What a corporation adds to the agent's own name. An agent may hold their WEBForms account
// in their personal real estate corporation's name, under its own email, while Real Signature
// has them as a person: "Jordan Sample Personal Real Estate Corporation" vs "Jordan Sample"
// (a Winnipeg tester, 2026-10-26). Longest first, so "Personal Real Estate Corporation" goes
// before "Corporation".
const CORP_SUFFIXES = [
  "personal real estate corporation", "professional real estate corporation",
  "real estate corporation", "professional corporation", "prec", "corporation", "corp",
  "incorporated", "inc", "limited", "ltd", "ltee", "ltée",
];
const words = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);

/** Is the WEBForms name a corporation named after the Real Signature person? Only when the
 *  name actually ends in a corporate suffix — a bare same name with another email is still a
 *  different person (father and son, see samePerson). The rest must be the person's name:
 *  same last name, and the first name equal or one a short form of the other ("Dan" /
 *  "Daniel"); middle names and initials in between are allowed. */
export function isOwnCorporation({ wfName, rsFirstName, rsLastName }) {
  let w = words(wfName);
  const first = words(rsFirstName)[0], last = words(rsLastName).at(-1);
  if (!first || !last) return false;
  let stripped = false;
  for (let again = true; again;) {
    again = false;
    for (const sfx of CORP_SUFFIXES) {
      const s = sfx.split(" ");
      if (w.length > s.length && w.slice(-s.length).join(" ") === sfx) { w = w.slice(0, -s.length); stripped = again = true; break; }
    }
  }
  if (!stripped || w.length < 2) return false;
  const [f, l] = [w[0], w.at(-1)];
  const firstOk = f === first || (Math.min(f.length, first.length) >= 3 && (f.startsWith(first) || first.startsWith(f)));
  return l === last && firstOk;
}

/** How the WEBForms sign-in relates to the Real Signature one, as a category for error
 *  reports (src/lib/report.js) — never who either of them is. → "same" | "own-corp" |
 *  "different" | "unknown" (no email to compare) | "none" (no WEBForms user known). */
export function wfMatch({ me, webformsUserName, webformsUserEmail = null }) {
  if (!webformsUserName && !webformsUserEmail) return "none";
  const same = samePerson({ wfEmail: webformsUserEmail, rsEmail: me?.email });
  if (same === true) return "same";
  if (same === null) return "unknown";
  const [rsFirstName, ...rest] = me?.firstName ? [me.firstName, me.lastName] : String(me?.fullName || "").split(" ");
  const rsLastName = me?.firstName ? me.lastName : rest.join(" ");
  return webformsUserName && isOwnCorporation({ wfName: webformsUserName, rsFirstName, rsLastName }) ? "own-corp" : "different";
}

/** Plain-language notes for the panel before Create, none blocking. Each has a level:
 *  "warn" — something to check before sending (the sender on someone else's deal);
 *  "info" — context only. WEBForms and Real Signature signed in as different people is a
 *  warning since 2026-10-15 (it was info from 2026-10-12, as normal for leads and TCs, until a
 *  TC's draft landed in the wrong agent's Drafts). → [{level, text}] */
export function actingNotes({ me, deal, webformsUserName, webformsUserEmail = null }) {
  const out = [];
  const acting = !!me?.actingForAgent;
  const whose = acting ? `${me.fullName || "the agent"}'s` : "your";
  if (acting) {
    out.push({ level: "info", text: `Acting as ${me.fullName || "an agent"} in Real Signature: the draft goes in their Drafts, with them as sender.` });
  }
  if (isOthersDeal(me, deal)) {
    // A teammate's deal the agent is on. Real files the draft under the signed-in (or
    // acted-for) agent, not the deal's owner.
    out.push({ level: "warn", text: `This deal is ${deal.agentName || "another agent"}'s. The draft will be in ${whose} Real Signature Drafts with ${acting ? "them" : "you"} as sender — check the sender before you press Send.` });
  }
  const same = samePerson({ wfEmail: webformsUserEmail, rsEmail: me?.email });
  const [rsFirstName, ...rest] = me?.firstName ? [me.firstName, me.lastName] : String(me?.fullName || "").split(" ");
  const rsLastName = me?.firstName ? me.lastName : rest.join(" ");
  if (webformsUserName && same === false && isOwnCorporation({ wfName: webformsUserName, rsFirstName, rsLastName })) {
    // Their own corporation's account: the same agent, so context, not a warning (Dan, 2026-10-26).
    const rsName = me?.fullName || [rsFirstName, rsLastName].filter(Boolean).join(" ");
    out.push({ level: "info", text: `WEBForms is signed in as ${webformsUserName}, taken as ${rsName}'s own corporation. The draft goes in ${acting ? `${rsName}'s` : "your"} Drafts, with ${acting ? "them" : "you"} as sender.` });
  } else if (webformsUserName && same === false) {
    // A warning, not a note (Dan, 2026-10-15): a TC impersonating one teammate in WEBForms
    // while acting as another in Real Signature put the first one's forms in the second
    // one's Drafts, sent as them. Says whose Drafts it lands in and what to switch.
    const rsName = me?.fullName || "another agent";
    out.push({ level: "warn", ...(acting ? { switchTo: webformsUserName } : {}), text: acting
      ? `Different people: WEBForms is ${webformsUserName}, Real Signature is acting as ${rsName}. The draft goes in ${rsName}'s Drafts — if these are ${webformsUserName}'s forms, switch "Acting as" first.`
      : `Different people: WEBForms is ${webformsUserName}, Real Signature is ${rsName}. The draft goes in your Drafts, with you as sender.` });
  } else if (webformsUserName && same === null) {
    out.push({ level: "info", text: `Couldn't confirm WEBForms (${webformsUserName}) and Real Signature (${me?.fullName || "?"}) are the same account — no email to compare.` });
  }
  return out;
}

/** A setup report with no names, emails, addresses or ids — counts and yes/no only — so a
 *  tester can paste it into a message. This is what the TC test collects. */
export function setupReport({ rs, wf }) {
  const yn = (b) => (b === true ? "yes" : b === false ? "no" : "unknown");
  const lines = [
    `Dotted Line setup check — ${new Date().toISOString().slice(0, 10)}`,
    `Real Signature signed in: ${yn(rs?.signedIn)}`,
  ];
  if (rs?.steps) lines.push(`Real Signature calls: ${rs.steps}`);
  if (rs?.signedIn) {
    lines.push(
      `Acting for an agent (TC): ${rs.actingForAgent ? "yes" : "no"}`,
      `Real account type: ${rs.type ?? "unknown"}`,
      `Real roles: ${(rs.roles || []).filter((r) => /^[A-Z_]+$/.test(r)).join(", ") || "none listed"}`,
      `Open deals visible: ${rs.deals} (own ${rs.ownDeals}, other agents' ${rs.deals - rs.ownDeals})`,
      `Open listings visible: ${rs.listings}`,
      `Templates: mine ${rs.templatesMine}, shared with me ${rs.templatesShared}, with signature blocks ${rs.templatesWithBlocks}`,
    );
  }
  lines.push(`WEBForms signed in: ${yn(wf?.signedIn)}`);
  if (wf?.signedIn && rs?.signedIn) lines.push(`Same person in both: ${yn(wf.samePerson)}`);
  lines.push(`Delegation verified in this version: ${yn(DELEGATION_VERIFIED)}`);
  return lines.join("\n");
}
