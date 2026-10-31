# How the panel decides

What Dotted Line chooses on the Set up screen, in the order it chooses it: which reZEN
deal, which side signs, how many, and who goes in as a signer. The agent can change every
answer in the panel; these are only its starting choices.

Keep this page in step with the code: a change to any of these rules updates its chart in
the same commit (`src/lib/deals.js`, `src/lib/auto.js`, `src/lib/draft.js`).

Blue: a question. Grey: a step. White: what the agent sees.

## 1. Which reZEN deal

Each open deal and listing is scored against the WEBForms address (`addressScore`,
`confidentDeal`). The house number has to match before the street words count.

```mermaid
flowchart TD
  A(["WEBForms deal opened in the panel"]) --> R{"Was a deal already chosen<br/>in Real Signature?"}
  R -- yes --> KEEP["Keep that deal"]
  R -- no --> S["Score every open reZEN deal and listing"]
  S --> C{"Same house number?<br/>(a number right before Ave or St is the<br/>street, not a house number: 9th Ave = 9 Ave)"}
  C -- no --> Z["Score 0"]
  C -- yes --> W["Score = 0.5 + half the share<br/>of street words in common"]
  W --> T{"Best score 0.75 or more,<br/>with no tie for first?"}
  T -- yes --> P["Pre-selected:<br/>'the address matches'"]
  T -- no --> B{"Exactly one Buyer Record<br/>with the buyers' names?"}
  B -- yes --> PB["Pre-selected:<br/>'the buyer's name matches'"]
  B -- no --> N{"Any deal scoring<br/>above 0.5?"}
  N -- no --> ND["No deal is pre-selected"]
  N -- yes --> CH["Choose a deal...<br/>close matches listed first"]

  classDef q fill:#eaf0ff,stroke:#1d4ed8,color:#1b2433
  classDef step fill:#f6f7fa,stroke:#c9d1e0,color:#1b2433
  classDef out fill:#ffffff,stroke:#1b2433,color:#1b2433
  class R,C,T,B,N q
  class S,W step
  class A,KEEP,Z,P,PB,ND,CH out
```

Example, invented: WEBForms says 120 9 Ave SE. The right deal is "120 9 Avenue Southeast"
and another is "300, 304, 308 9 ave se". The second shares only the avenue's 9, so it
scores 0, and the first is picked.

## 2. Which side signs

Only the agent's own clients sign through them; the other side signs with their own agent
(`signerCounts`).

```mermaid
flowchart TD
  A(["Deal picked, or No deal"]) --> D{"Is the deal buy side or<br/>listing side in reZEN?"}
  D -- yes --> D1["That side's clients sign"]
  D -- "dual, unknown or no deal" --> E{"Is the agent's email on the<br/>WEBForms form or Contacts<br/>as one side's agent?"}
  E -- yes --> E1["That side signs<br/>(both, if on both)"]
  E -- no --> TP{"Do the picked templates have<br/>blocks for one side only?"}
  TP -- yes --> T1["That side signs"]
  TP -- no --> FN{"Do the form names point one way?<br/>Listing, Buyer, Seller, Tenant, Landlord"}
  FN -- yes --> F1["That side signs"]
  FN -- no --> BOTH["Buyers and sellers both sign"]

  classDef q fill:#eaf0ff,stroke:#1d4ed8,color:#1b2433
  classDef out fill:#ffffff,stroke:#1b2433,color:#1b2433
  class D,E,TP,FN q
  class A,D1,E1,T1,F1,BOTH out
```

## 3. How many on the signing side

An empty slot is one click to delete in Real Signature; a missing one means placing its
blocks by hand. So the fallback is 2, but only once nothing better is known
(`signerCounts`; the WEBForms names from `partiesFromContacts` and `partiesFromFormValues`).

```mermaid
flowchart TD
  A(["For the buyers, then for the sellers"]) --> F{"Are names read in WEBForms?<br/>Contacts, or the buyer and seller<br/>lines on Alberta forms<br/>(a run-on line like '(operating as ...)'<br/>is the name above it, not another person)"}
  F -- yes --> F1["That many"]
  F -- no --> DL{"Does the picked deal list<br/>people on this side?"}
  DL -- yes --> D1["The deal's own count"]
  DL -- no --> TS{"Does a picked template have<br/>more than 2 slots?"}
  TS -- yes --> T1["The template's number of slots"]
  TS -- no --> TWO["2"]

  classDef q fill:#eaf0ff,stroke:#1d4ed8,color:#1b2433
  classDef out fill:#ffffff,stroke:#1b2433,color:#1b2433
  class F,DL,TS q
  class A,F1,D1,T1,TWO out
```

## 4. Who goes in as a signer

Real Signature refuses the whole document if any signer has a blank email or name, so
those people are left off and named in the panel (`signeesFromDeal`,
`signersWithoutEmail`). If "Add the agent as a signer" is ticked, the agent chosen is
added after them.

```mermaid
flowchart TD
  A(["Each person on the deal, in reZEN's order,<br/>up to the count"]) --> EM{"Has an email?"}
  EM -- no --> OFF1["Left off; the panel says<br/>'has no email in reZEN'<br/>(their slot number is kept)"]
  EM -- yes --> NM{"Has a first or last name?"}
  NM -- yes --> ON["Signer, under their own name"]
  NM -- no --> CO{"Has a company name?"}
  CO -- yes --> ONC["Signer, under the company's name"]
  CO -- no --> OFF2["Left off; the panel says<br/>'has no name in reZEN'"]

  classDef q fill:#eaf0ff,stroke:#1d4ed8,color:#1b2433
  classDef out fill:#ffffff,stroke:#1b2433,color:#1b2433
  class EM,NM,CO q
  class A,OFF1,ON,ONC,OFF2 out
```
