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
  const [mine, shared, deals, listings] = await Promise.all([
    rs.allTemplates(),
    rs.allTemplates({ sharedWithMe: true }),
    rs.allOpenDeals(me.id),
    rs.allOpenDeals(me.id, { listings: true }),
  ]);
  const templates = new Map();
  for (const t of mine) templates.set(t.id, { t, shared: false });
  for (const t of shared) if (!templates.has(t.id)) templates.set(t.id, { t, shared: true });
  const dealMap = new Map();
  for (const d of deals) dealMap.set(d.id, lib.summarizeDeal(d));
  for (const d of listings) if (!dealMap.has(d.id)) dealMap.set(d.id, lib.summarizeDeal(d, { listing: true }));
  ctx = { rs, lib, me, templates, deals: dealMap, roles: null };
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

async function create({ jobId, title, dealId, templateIds, counts }) {
  const c = await context();
  const { rs, lib } = c;
  const job = await chrome.runtime.sendMessage({ type: "job:get", id: jobId });
  if (!job || job.error) throw new Error("This hand-off has expired. Start again from WEBForms.");
  if (templateIds.length !== job.forms.length) throw new Error("Pick a template (or none) for every form.");
  const deal = dealId ? c.deals.get(dealId) : null;
  if (dealId && !deal) throw new Error("That deal is no longer in your open deals.");

  const sender = lib.senderFor(c.me, deal);
  const signees = deal ? lib.signeesFromDeal(deal, counts) : [];
  const created = [];
  let packetId = null;
  try {
    for (const [i, form] of job.forms.entries()) {
      const pdf = new Blob([lib.fromBase64(form.pdfBase64)], { type: "application/pdf" });
      const up = await rs.uploadDraft(pdf, fileName(form.name));
      if (!up?.id) throw new Error("Real Signature's upload answer changed shape");
      created.push(up.id);
      const draft = await rs.getTemplate(up.id);
      let layout = null;
      if (templateIds[i]) {
        const t = c.templates.get(templateIds[i])?.t || (await rs.getTemplate(templateIds[i]));
        layout = lib.dropUnusedSlots(lib.stripTemplate(t), counts);
      }
      await rs.putDraft(up.id, lib.buildDraftBody({
        draft, layout,
        name: job.forms.length > 1 ? String(form.name).replace(/\.pdf$/i, "") : title,
        pageCount: form.pageCount, transactionId: deal?.id, counts, signees, sender,
      }));
    }
    if (created.length > 1) {
      const p = await rs.createPacketDraft(title, created);
      if (!p?.id) throw new Error("Real Signature's packet answer changed shape");
      packetId = p.id;
      return { url: `/one-time-documents/packet/${packetId}`, drafts: created.length, packet: true };
    }
    return { url: `/prepare/${created[0]}`, drafts: 1, packet: false };
  } catch (e) {
    if (packetId) await rs.deletePacketDraft(packetId).catch(() => {});
    for (const id of created) await rs.deleteDraft(id).catch(() => {});
    throw e;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const run = {
    "rs:context": summary,
    "rs:setup": setup,
    "rs:create": () => create(msg),
  }[msg.type];
  if (!run) return false;
  run().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});
