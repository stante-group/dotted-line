// A stand-in `chrome` for the store screenshots: the real panel code, fed invented data
// (Jordan Sample, 120 Example Street NW). Never a real deal, form or person — the
// screenshots go on a public listing. Not part of the extension package.
(() => {
  const scene = new URLSearchParams(location.search).get("scene") || "rs";
  const WF = "https://pr.transactiondesk.com/", RS = "https://signature.therealbrokerage.com/";
  const store = { sync: {}, local: {} };
  const area = (a) => ({
    get: async (k) => (await ready, k == null ? { ...store[a] } : Object.fromEntries([].concat(k).filter((x) => x in store[a]).map((x) => [x, store[a][x]]))),
    set: async (o) => { Object.assign(store[a], o); },
  });
  const ev = () => ({ addListener() {}, removeListener() {} });

  const forms = [
    { id: "f1", name: "Residential Purchase Contract", transactionId: "T1" },
    { id: "f2", name: "Consumer Relationships Guide", transactionId: "T1" },
  ];
  const agent = { id: "a1", firstName: "Alex", lastName: "Example", fullName: "Alex Example", email: "alex@example.com", type: "AGENT" };
  const deal = (id, address, side, people, kind = "deal") => ({
    id, kind, side, address, agentName: "Alex Example", ownerId: "a1", mlsNum: "",
    participants: people.map(([role, firstName, lastName]) => ({ role, firstName, lastName, email: `${firstName.toLowerCase()}@example.com` })),
  });
  const deals = [
    deal("d1", "120 Example Street NW, Calgary, AB", "BUYER", [["BUYER", "Jordan", "Sample"], ["BUYER", "Casey", "Sample"]]),
    deal("d2", "455 Sample Avenue SW, Calgary, AB", "SELLER", [["SELLER", "Morgan", "Demo"]], "listing"),
    deal("d3", "78 Placeholder Crescent NE, Calgary, AB", "BUYER", [["BUYER", "Riley", "Test"]]),
  ];
  const slots = (b, s, a) => ({ BUYER: b, SELLER: s, AGENT: a });
  const templates = [
    { id: "t1", name: "Purchase Contract – buyers", pagesCount: 10, blocks: 38, shared: false, slots: slots(2, 0, 1), agentRole: "BUYERS_AGENT" },
    { id: "t3", name: "Purchase Contract – team", pagesCount: 10, blocks: 30, shared: true, slots: slots(2, 0, 1), agentRole: "BUYERS_AGENT" },
  ];
  const job = {
    id: "job1", title: "120 Example Street NW – Purchase Contract",
    address: "120 Example Street NW Calgary", buyerNames: ["Jordan Sample", "Casey Sample"], agentSide: "BUYER",
    parties: { BUYER: 2, SELLER: 0 }, contactPeople: [], webformsUserName: "Alex Example", webformsUserEmail: "alex@example.com",
    forms: [
      { id: "f1", name: "Residential Purchase Contract", pageCount: 10, parties: { BUYER: 2, SELLER: 0 } },
      { id: "f2", name: "Consumer Relationships Guide", pageCount: 4, parties: { BUYER: 2, SELLER: 0 } },
    ],
  };
  // The purchase contract's template already remembered, so the shot shows a finished pick
  // ("(last used)"); the guide has no template, so it shows Auto place. Reports already
  // answered, so the first-run question doesn't cover the panel.
  const ready = import("../../src/lib/match.js").then((m) => {
    store.local.templateFor = { [m.rememberKey(job.forms[0], "BUYER")]: m.rememberEntry(job.forms[0], templates[0]) };
    store.local.reporting = "yes";
  });

  const tabReply = {
    "webforms:details": () => ({
      userName: "Alex Example", userEmail: "alex@example.com",
      transaction: { Name: "Sample purchase", Address: "120 Example Street NW Calgary" },
      firstFormValues: null, buyerNames: job.buyerNames, agentSide: "BUYER", parties: job.parties, contactPeople: [],
      forms: [
        { id: "f1", pageCount: 10, typeName: "Residential Purchase Contract", parties: job.parties },
        { id: "f2", pageCount: 4, typeName: "Consumer Relationships Guide", parties: job.parties },
      ],
    }),
    "rs:context": () => ({ signedIn: true, me: agent, templates, deals }),
  };

  window.chrome = {
    storage: { sync: area("sync"), local: area("local"), onChanged: ev() },
    tabs: {
      query: async () => [{ id: 1, active: true, status: "complete", url: scene === "wf" ? `${WF}app/transaction` : `${RS}drafts` }],
      get: async () => ({ id: 1, status: "complete" }),
      sendMessage: async (_id, msg) => (tabReply[msg.type] || (() => ({})))(msg),
      update: async () => ({}), create: async () => ({ id: 2 }), remove: async () => {},
      onActivated: ev(), onUpdated: ev(),
    },
    scripting: {
      executeScript: async () => [{ result: { source: "deal", transactionId: "T1", forms } }],
    },
    runtime: {
      sendMessage: async (msg) => (msg.type === "job:forTab" ? job : null),
      onMessage: ev(),
      getURL: (p) => `../../${p}`,
      getManifest: () => ({ version: "0.2.0", action: { default_title: "Dotted Line" } }),
      openOptionsPage() {},
    },
    action: { setPopup: async () => {} },
    sidePanel: { setOptions: async () => {} },
  };
})();
