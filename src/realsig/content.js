// Real Signature side. Runs in the signature.therealbrokerage.com tab so every API call
// goes out with the page's own origin and sign-in. Draft only — see src/lib/realsig-api.js.
//
// The side panel shows the choices (deal, template per form, signer counts); this script
// does the work when the agent clicks Create:
//   1. each form's PDF → a one-time draft (bytes unchanged);
//   2. PUT each draft: template blocks (unused signer slots removed), deal, signers, sender;
//   3. several forms → grouped as a packet draft, the same call as Real's "create packet";
//   4. reply with the draft's URL; the panel lands the agent there. They press Send.
// If any step fails, the drafts this run made are deleted (best effort) so nothing
// half-made is left in the agent's Drafts.

let ctx = null; // { rs, lib, me, templates: Map, deals: Map } — this tab's lifetime only

async function load() {
  const lib = {};
  for (const p of ["realsig-api.js", "layout.js", "deals.js", "draft.js", "actor.js", "pdf.js"]) {
    Object.assign(lib, await import(chrome.runtime.getURL(`src/lib/${p}`)));
  }
  return lib;
}

async function context({ fresh = false } = {}) {
  if (ctx && !fresh) return ctx;
  const lib = await load();
  const rs = new lib.RealSignature({ getToken: () => lib.readToken(document.cookie), getActingAs: () => lib.readActingAs(document.cookie) });
  // A TC acting for an agent ("Acting as" in Real Signature) works as that agent: every call
  // carries X-Agent-Context, and templates, deals and drafts are the agent's. She has no
  // reZEN profile of her own (/users/me → 404) and may not read the agent's (/users/{id} →
  // 403), so the agent's name and email come from the agent's own deals (2026-10-15).
  const actingAs = lib.readActingAs(document.cookie);
  const own = actingAs ? null : lib.meFromYenta(await rs.me());
  const id = actingAs || own.id;
  const [mine, shared, deals, listings, buyers] = await Promise.all([
    rs.allTemplates(),
    rs.allTemplates({ sharedWithMe: true }),
    rs.allOpenDeals(id),
    rs.allOpenDeals(id, { listings: true }),
    // Newer than the rest of reZEN (2026-10-12) and only a convenience: if it fails or
    // changes shape, the picker carries on without Buyer Records.
    rs.activeBuyerRecords(id).catch(() => []),
  ]);
  const me = actingAs ? { ...lib.meFromDeals([...deals, ...listings], actingAs), actingForAgent: true }
    : own;
  const templates = new Map();
  for (const t of mine) templates.set(t.id, { t, shared: false });
  for (const t of shared) if (!templates.has(t.id)) templates.set(t.id, { t, shared: true });
  const dealMap = new Map();
  for (const d of deals) dealMap.set(d.id, lib.summarizeDeal(d));
  for (const d of listings) if (!dealMap.has(d.id)) dealMap.set(d.id, lib.summarizeDeal(d, { listing: true }));
  for (const b of buyers) {
    try { const s = lib.summarizeBuyerRecord(b); if (!dealMap.has(s.id)) dealMap.set(s.id, s); } catch { /* skip one odd record */ }
  }  ctx = { rs, lib, me, templates, deals: dealMap, roles: null };
  return ctx;
}

const BLOCK_TYPES = new Set(["SIGNATURE", "INITIALS", "SIGNED_DATE", "SIGNED_DATE_ONLY", "SIGNED_TIME_ONLY"]);
const blockCount = (t) => (t.fieldDefinitions || []).filter((f) => BLOCK_TYPES.has(f.type)).length;

async function summary() {
  let c;
  try {
    c = await context({ fresh: true });
  } catch (e) {
    if (e?.name === "NotSignedIn" || /sign-in|Not signed in/i.test(String(e?.message))) return { signedIn: false };
    throw e;
  }
  return {
    signedIn: true,
    me: c.me,
    templates: [...c.templates.values()].map(({ t, shared }) => ({
      id: t.id, name: t.name, pagesCount: t.pagesCount ?? null, blocks: blockCount(t), shared,
      slots: c.lib.templateSlots(t.fieldDefinitions),
      agentRole: c.lib.agentRoleFor({ layout: { signeeConfigs: t.signeeConfigs || [] } }),
    })),
    deals: [...c.deals.values()],
  };
}

// Each call on its own, so a failure says WHICH one: a TC whose agent hadn't switched on
// Real Signature for her came back "signed in: no" with nothing to go on (2026-10-15).
// Status codes and counts only — Real's error text can carry names, and this report gets
// pasted into messages. Shown when not signed in, and for a TC acting for an agent.
async function steps() {
  const lib = await load();
  const rs = new lib.RealSignature({ getToken: () => lib.readToken(document.cookie), getActingAs: () => lib.readActingAs(document.cookie) });
  const code = (e) => (e?.name === "NotSignedIn" ? "401" : /→ (d{3})/.exec(String(e?.message))?.[1] || "error");
  const actingAs = lib.readActingAs(document.cookie);
  const out = { token: lib.readToken(document.cookie) ? "yes" : "no", acting: actingAs ? "yes" : "no" };
  const run = async (k, f) => { try { const r = await f(); out[k] = "ok"; return r; } catch (e) { out[k] = code(e); return null; } };
  // Every call carries X-Agent-Context when acting, as Real's app does. A TC's own /users/me
  // is a 404 by design — her agent's deals give the id instead.
  let id = actingAs;
  if (!actingAs) {
    const me = await run("me", () => rs.me());
    try { id = me && lib.meFromYenta(me).id; } catch { out.me = "odd shape"; }
  }
  await run("roles", () => rs.roles());
  const count = (r) => (Array.isArray(r?.data) ? ` ${r.totalCount ?? r.data.length}` : "");
  const t = await run("templates", () => rs.listTemplates({ size: 1 }));
  if (t) out.templates += count(t);
  const s = await run("shared", () => rs.listTemplates({ sharedWithMe: true, size: 1 }));
  if (s) out.shared += count(s);
  if (id) {
    const some = (r) => (Array.isArray(r?.transactions) ? ` (${r.hasNext ? "more than 1" : r.transactions.length})` : " (odd shape)");
    const d = await run("deals", () => rs.openDeals(id, { pageSize: 1 }));
    if (d) out.deals += some(d);
    const l = await run("listings", () => rs.openDeals(id, { listings: true, pageSize: 1 }));
    if (l) out.listings += some(l);
  }
  return Object.entries(out).map(([k, v]) => `${k} ${v}`).join(", ");
}

async function setup() {
  let c;
  try { c = await context({ fresh: true }); } catch { return { signedIn: false, steps: await steps().catch(() => "unavailable") }; }
  let roles = [];
  try { roles = await c.rs.roles(); } catch { /* optional */ }
  const all = [...c.deals.values()];
  const deals = all.filter((d) => d.kind === "deal");
  const tpls = [...c.templates.values()];
  return {
    signedIn: true,
    steps: c.lib.readActingAs(document.cookie) ? await steps().catch(() => "unavailable") : null, // TC: show the calls too
    fullName: c.me.fullName, // compared in the panel, never printed in the report
    email: c.me.email, // likewise
    type: c.me.type,
    actingForAgent: !!c.me.actingForAgent,
    roles,
    deals: deals.length,
    ownDeals: deals.filter((d) => d.ownerId === c.me.id).length,
    listings: all.length - deals.length,
    templatesMine: tpls.filter((x) => !x.shared).length,
    templatesShared: tpls.filter((x) => x.shared).length,
    templatesWithBlocks: tpls.filter((x) => blockCount(x.t) > 0).length,
  };
}

const fileName = (name) => `${String(name).replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "_")}.pdf`;

// agentChoice: null = don't add the agent; "all" = every agent on the deal; else the email
// of the one agent who signs (see chooseAgents).
async function create({ jobId, title, dealId, templateIds, counts, agentChoice = null, emailSubject = null }) {
  const c = await context();
  const { rs, lib } = c;
  const job = await chrome.runtime.sendMessage({ type: "job:get", id: jobId });
  if (!job || job.error) throw new Error("This hand-off has expired. Start again from WEBForms.");
  if (templateIds.length !== job.forms.length) throw new Error("Pick a template (or none) for every form.");
  const deal = dealId ? c.deals.get(dealId) : null;
  if (dealId && !deal) throw new Error("That deal is no longer in your open deals.");

  const sender = lib.senderFor(c.me, deal);
  // No reZEN deal: the WEBForms deal's Buyer and Seller contacts, those with an email.
  const signees = lib.signeesFromDeal(deal || { participants: job.contactPeople || [] }, counts);
  const created = [];
  let packetId = null;
  const unfilled = new Set(); // signer roles left for the agent to fill (see unfilledRoles)
  // Seconds per step, summed over the forms (numbers only, for "Check my setup").
  const timings = { upload: 0, readBack: 0, save: 0 };
  const timed = async (k, p) => { const s = Date.now(); try { return await p; } finally { timings[k] = Math.round(((timings[k] || 0) + (Date.now() - s) / 1000) * 10) / 10; } };
  try {
    for (const [i, form] of job.forms.entries()) {
      const pdf = new Blob([lib.fromBase64(form.pdfBase64)], { type: "application/pdf" });
      const up = await timed("upload", rs.uploadDraft(pdf, fileName(form.name)));
      if (!up?.id) throw Object.assign(new Error("Real Signature's upload answer changed shape"), { leftover: true });
      created.push(up.id);
      const draft = await timed("readBack", rs.getTemplate(up.id));
      let layout = null;
      if (templateIds[i]) {
        const t = c.templates.get(templateIds[i])?.t || (await rs.getTemplate(templateIds[i]));
        layout = lib.dropUnusedSlots(lib.stripTemplate(t), counts);
      }
      // The agent signs this form only if its template has an agent slot, or it has no
      // template (blocks placed by hand); see agentRoleFor.
      let agents = null;
      if (agentChoice) {
        const role = lib.agentRoleFor({ layout, counts, dealSide: deal?.side || job.agentSide });
        const people = role ? lib.chooseAgents(lib.agentPeople({ deal, role, me: c.me, webformsUserName: job.webformsUserName, webformsUserEmail: job.webformsUserEmail }), agentChoice) : [];
        if (people.length) agents = { signeeType: role, people };
      }
      const body = lib.buildDraftBody({
        draft, layout,
        name: job.forms.length > 1 ? String(form.name).replace(/\.pdf$/i, "") : title,
        // A Buyer Record gives the buyers; whether a draft can be attached to one is untested.
        pageCount: form.pageCount, transactionId: deal?.kind === "buyer" && !lib.BUYER_RECORDS_ATTACH ? null : deal?.id, counts, signees, sender, agents,
        // From the panel (the title, the agent's pattern, or null = Real's own). A packet has
        // no settings of its own, so every document carries the same subject.
        emailSubject,
      });
      for (const r of lib.unfilledRoles(body)) unfilled.add(r);
      await timed("save", rs.putDraft(up.id, body));
    }
    // One form with a signer role nobody fills (no email for the buyer, say) goes in a packet
    // of one: a single document's Edit details hides empty roles and its Next deletes them,
    // blocks and all; a packet lists every role and asks for each (2026-10-14, see
    // docs/api-notes.md). All filled → a plain single draft, as before.
    if (created.length > 1 || unfilled.size) {
      const p = await timed("packet", rs.createPacketDraft(title, created));
      if (!p?.id) throw Object.assign(new Error("Real Signature's packet answer changed shape"), { leftover: true });
      packetId = p.id;
      return { url: `/one-time-documents/packet/${packetId}`, drafts: created.length, packet: true, unfilled: [...unfilled], timings };
    }
    // The page Real's own Drafts pencil opens: Transaction → Edit details (signers, names,
    // emails) → Prepare → Review. /prepare/{id} jumped past the first two, so an agent
    // couldn't see who the draft was going to (2026-10-12).
    return { url: `/one-time-documents/document/${created[0]}`, drafts: 1, packet: false, timings };
  } catch (e) {
    // Clean up what this run made, and say so when that can't be vouched for (outside
    // review, 2026-10-15): a delete that fails, or an answer with no id — Real may have made
    // the draft or packet anyway, and there's no id to delete it by.
    let failed = 0;
    if (packetId) await rs.deletePacketDraft(packetId).catch(() => { failed++; });
    for (const id of created) await rs.deleteDraft(id).catch(() => { failed++; });
    if (failed || e?.leftover) {
      throw new Error(`${String(e?.message || e)}. Check your Real Signature Drafts for a half-made draft and delete it.`);
    }
    throw e;
  }
}

// A DocuSign template, converted on the Settings page (src/lib/docusign.js), becomes a new
// reusable template here: upload its PDF, then one full PUT with the blocks — the same two
// steps as a draft, with oneTimeUse false (2026-10-15). A new template only; the agent's
// own are never touched. If the PUT fails, the half-made one is deleted.
async function importTemplate({ pdfBase64, template }) {
  const lib = await load();
  const rs = new lib.RealSignature({ getToken: () => lib.readToken(document.cookie), getActingAs: () => lib.readActingAs(document.cookie) });
  const bytes = lib.fromBase64(pdfBase64);
  if (!lib.isPdf(bytes)) throw new Error("the template file's document isn't a PDF");
  const up = await rs.uploadTemplate(new Blob([bytes], { type: "application/pdf" }), fileName(template.name));
  if (!up?.id) throw new Error("Real Signature's upload answer changed shape — check My Templates for a half-made one");
  try {
    const fresh = await rs.getTemplate(up.id);
    await rs.putDraft(up.id, { ...fresh, ...template });
  } catch (e) {
    const gone = await rs.deleteDraft(up.id).then(() => true, () => false);
    throw new Error(`${String(e?.message || e)}${gone ? "" : ". Check My Templates in Real Signature for a half-made template and delete it."}`);
  }
  ctx = null; // the panel's next look lists the new template
  return { id: up.id, url: `/prepare/${up.id}` };
}

/** Open Real's own "Acting as" menu (bottom left), so the TC can pick another agent. Opens
 *  it only — the pick is hers. Found by its label; Real's markup may change, so a miss just
 *  says so and the panel tells her where it is. */
async function openActing() {
  const label = [...document.querySelectorAll("body *")].find((n) =>
    n.children.length === 0 && /^acting as$/i.test(n.textContent.trim()));
  let box = label?.parentElement;
  for (let i = 0; box && i < 3; i++, box = box.parentElement) {
    const btn = box.querySelector("button, [role=button], [aria-haspopup]");
    if (btn) { btn.click(); return { opened: true }; }
  }
  return { opened: false };
}

// Real keeps the TC's pick in a cookie. Tell the panel which agent is current — when this
// page loads (Real reloads the page on a switch, so a watcher that only reported CHANGES
// started with the new agent and said nothing, 2026-10-15) and on any change after. The
// panel reloads if it isn't the agent it loaded.
{
  const now = () => {
    const v = decodeURIComponent(/(?:^|;s*)actingAsUserId=([^;]*)/.exec(document.cookie)?.[1] || "").replace(/^"|"$/g, "");
    return v && v !== "null" && v !== "undefined" ? v : null;
  };
  const tell = (actingAs) => chrome.runtime.sendMessage({ type: "rs:acting", actingAs }).catch(() => { /* panel closed */ });
  let last = now();
  tell(last);
  setInterval(() => {
    const v = now();
    if (v === last) return;
    last = v;
    ctx = null;
    tell(v);
  }, 1000);
}

// A hand-off from WEBForms still under way when the agent clicks over to this tab — before
// the side panel could open here — used to look like nothing at all (2026-10-15). A small
// notice says what's happening; it goes once the side panel shows, or the draft opens.
// Shadow DOM, so Real's styles and ours never mix; text only, never Real's look.
let notice = null;
function showNotice(p) {
  if (!p || p.hide) { notice?.remove(); notice = null; return; }
  if (!notice) {
    notice = document.createElement("div");
    const root = notice.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      div { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 320px;
        background: #fff; color: #1f2937; border: 1px solid #d1d5db; border-left: 4px solid #2563eb;
        border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.15); padding: 10px 12px;
        font: 13px/1.4 system-ui, sans-serif; }
      b { display: block; margin-bottom: 2px; } div.err { border-left-color: #b91c1c; }
    </style><div><b>Dotted Line</b><span></span></div>`;
    document.documentElement.append(notice);
    notice.box = root.querySelector("div");
    notice.text = root.querySelector("span");
  }
  notice.box.className = p.error ? "err" : "";
  notice.text.textContent = p.error ? `Couldn't bring your forms over: ${p.error}`
    : p.busy ? `${p.busy} Stay on this tab or go back — it carries on either way.`
    : "Your forms are here. Click the Dotted Line icon in the toolbar to finish the draft.";
}
chrome.runtime.sendMessage({ type: "job:status" }).then(showNotice, () => {});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  // Notices about this tab's hand-off: no reply needed.
  if (msg?.type === "rs:handoff") { showNotice(msg); return false; }
  if (msg?.type === "rs:notice-hide") { showNotice(null); return false; }
  const run = {
    "rs:open-acting": openActing,
    "rs:context": summary,
    "rs:setup": setup,
    "rs:import-template": () => importTemplate(msg),
    "rs:create": () => create(msg),
  }[msg.type];
  if (!run) return false;
  run().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});
