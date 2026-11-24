// Where Real Signature lives. Real moved its app from signature.therealbrokerage.com to
// signature.realremaxgroup.com without notice (found by Dan, 2026-11-18): the old address
// now 302s to the new one, so every agent lands there, and a Dotted Line that only knew the
// old host had no script on the page, no side panel and no Real Signature tab to talk to.
// Both stay listed: Real could send some accounts back, and the old one costs nothing.
// Only the app moved. Its API hosts (signature-api, arrakis, yenta, keymaker) are still on
// therealbrokerage.com, so realsig-api.js is unchanged; the new site's own code calls them.
// The manifest's host_permissions name Real's two whole DOMAINS, not these two addresses
// (RS_DOMAINS, Dan, 2026-11-18): a new site in host_permissions makes Chrome switch the
// extension off on every install until the agent clicks Re-enable, and 0.3.4 paid that once.
// With the domains granted, the next move inside either one (signature.* to anything.*) is a
// silent update: add the address here and to the two narrow lists below. Those stay exact,
// so the script only ever runs on Real Signature, never on Real's sign-in or reZEN pages:
// content_scripts and web_accessible_resources name RS_PATTERNS. A move to a THIRD domain
// still costs a Re-enable. test/sites.test.js fails if any of this drifts apart.

/** The app's address today: new Real Signature URLs are built on this one. */
export const RS = "https://signature.realremaxgroup.com/";
/** Every address Real Signature has had, newest first. */
export const RS_HOSTS = [RS, "https://signature.therealbrokerage.com/"];
/** For chrome.tabs.query({ url }), which takes a list. */
export const RS_PATTERNS = RS_HOSTS.map((h) => `${h}*`);
/** Real's own domains, as host_permissions grants them. Every RS_HOSTS address is inside one. */
export const RS_DOMAINS = ["https://*.realremaxgroup.com/*", "https://*.therealbrokerage.com/*"];
/** The host part of a regular expression matching any of them. */
export const RS_HOST_RE = "https:\\/\\/signature\\.(?:realremaxgroup|therealbrokerage)\\.com";

/** Is this URL a Real Signature page? */
export const isRs = (url) => RS_HOSTS.some((h) => String(url || "").startsWith(h));

// ---------- the Real Signature pages the panel reacts to (panel.js) ----------

// Real's one-time document steps (Transaction → Edit details → Prepare → Review) all live at
// this address. A packet's are at PACKET_URL below.
export const DRAFT_URL = new RegExp(`^${RS_HOST_RE}\\/one-time-documents\\/document\\/([0-9a-f-]{36})(?:[/?#]|$)`, "i");
// Clicking a draft on the Drafts list opens its preview first, with Next to the steps
// (Dan's test, 2026-10-30) — the place to set it up. Only a one-time draft's preview: the
// same /view/ pages show sent documents, which are never touched.
export const VIEW_URL = new RegExp(`^${RS_HOST_RE}\\/view\\/document\\/([0-9a-f-]{36})\\?(?:[^#]*&)?oneTimeUse=true(?:[&#]|$)`, "i");
// A packet's own steps (its Edit, where the signers are set once for every document) and
// its one-time preview. Clicking the packet's name opens the preview, which has no actions;
// its Edit opens the steps (Dan's test, 2026-10-30).
export const PACKET_URL = new RegExp(`^${RS_HOST_RE}\\/one-time-documents\\/packet\\/([0-9a-f-]{36})(?:[/?#]|$)`, "i");
export const PACKET_VIEW_URL = new RegExp(`^${RS_HOST_RE}\\/view\\/packet\\/([0-9a-f-]{36})\\?(?:[^#]*&)?oneTimeUse=true(?:[&#]|$)`, "i");
/** The one-time document open on this page, or null. */
export const draftIdOf = (url) => DRAFT_URL.exec(url)?.[1] || VIEW_URL.exec(url)?.[1] || null;
/** The one-time packet open on this page, or null. */
export const packetIdOf = (url) => PACKET_URL.exec(url)?.[1] || PACKET_VIEW_URL.exec(url)?.[1] || null;

// Real Signature's home pages (Sent, Draft, Voided — where a dropped PDF lands). Before the
// draft's own steps there was nothing in the panel (Dan's test, 2026-10-30).
export const HOME_URL = new RegExp(`^${RS_HOST_RE}\\/home(?:[/?#]|$)`, "i");
