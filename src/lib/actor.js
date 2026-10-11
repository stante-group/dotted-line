// Who is acting, and for whom — the framework for Phase 0 item 7 (TC delegation).
//
// A transaction coordinator makes drafts on other agents' deals. Three identities can
// differ, and each mismatch means something different:
//   - the Real Signature sign-in (`me`, yenta users/me) — whose Drafts list it lands in;
//   - the deal's owner (arrakis `transactionOwner`) — whose deal it is;
//   - the WEBForms sign-in (`UserName`) — whose forms these are (or who is impersonating).
//
// WHAT IS NOT YET KNOWN (needs the TC at her own computer — docs/tc-delegation-test.md):
//   - Whether a draft she makes on an agent's deal should name the agent as sender.
//     Real Signature drafts carry `defaults.sender.agentYentaId` (null on an agent's own
//     drafts); it is probably how "sending on behalf of" is recorded, but we have never
//     seen it set. Until verified we leave it null — the draft goes out as from whoever
//     is signed in, exactly as if she'd uploaded it herself — and say so on screen.
//   - What WEBForms' UserName shows while she impersonates an agent.
// Flip DELEGATION_VERIFIED only after the test, together with senderFor().

export const DELEGATION_VERIFIED = false;

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

/** The draft's `defaults.sender`. Same as Real's own UI for a draft you make yourself. */
export function senderFor(me /*, deal */) {
  // When DELEGATION_VERIFIED: set agentYentaId to deal.ownerId if that is what Real does
  // for an assistant's draft. Not before.
  return { firstName: me.firstName, lastName: me.lastName, email: me.email, agentYentaId: null };
}

export function isOthersDeal(me, deal) {
  return !!(deal && deal.ownerId && me && deal.ownerId !== me.id);
}

/** Plain-language notes for the panel before Create. Informational, not blocking. */
export function actingNotes({ me, deal, webformsUserName }) {
  const out = [];
  if (isOthersDeal(me, deal)) {
    out.push(DELEGATION_VERIFIED
      ? `You're making this for ${deal.agentName || "another agent"}.`
      : `This deal is ${deal.agentName || "another agent"}'s. The draft will be in your Real Signature Drafts with you as sender — check the sender in Real Signature before you press Send.`);
  }
  if (webformsUserName && me?.fullName && norm(webformsUserName) !== norm(me.fullName)) {
    out.push(`WEBForms is signed in as ${webformsUserName}; Real Signature as ${me.fullName}.`);
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
  if (rs?.signedIn) {
    lines.push(
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
