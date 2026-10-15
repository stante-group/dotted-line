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
  const rs = new lib.RealSignature({ getToken: () => lib.readToken(document.cookie) });
  const me = lib.meFromYenta(await rs.me());
  const [mine, shared, deals, listings, buyers] = await Promise.all([
    rs.allTemplates(),
    rs.allTemplates({ sharedWithMe: true }),
    rs.allOpenDeals(me.id),
    rs.allOpenDeals(me.id, { listings: true }),
    // Newer than the rest of reZEN (2026-10-12) and only a convenience: if it fails or
    // changes shape, the picker carries on without Buyer Records.
    rs.activeBuyerRecords(me.id).catch(() => []),
  ]);
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

async function setup() {
  let c;
  try { c = await context({ fresh: true }); } catch { return { signedIn: false }; }
  let roles = [];
  try { roles = await c.rs.roles(); } catch { /* optional */ }
  const all = [...c.deals.values()];
  const deals = all.filter((d) => d.kind === "deal");
  const tpls = [...c.templates.values()];
  return {
    signedIn: true,
    fullName: c.me.fullName, // compared in the panel, never printed in the report
    email: c.me.email, // likewise
    type: c.me.type,
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
  const rs = new lib.RealSignature({ getToken: () => lib.readToken(document.cookie) });
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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const run = {
    "rs:context": summary,
    "rs:setup": setup,
    "rs:import-template": () => importTemplate(msg),
    "rs:create": () => create(msg),
  }[msg.type];
  if (!run) return false;
  run().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});
