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

Placing from a form's own labels never uses the deal to decide a **customer's** side
(Alberta: someone the agent does not represent, on either side). On a customer form the
customer's lines go to the side its title names ("Tenant Customer…" is the buyer slot), and
with no side named they are left for the agent (`formSides`, 2026-11-03).

CREA's national forms sign on a bare "Signed:" line, and the title alone says whose it is:
the seller on the REALTOR® Cooperation Disclosure and Consent Form, the buyer on the
Certificate and Consent of Purchaser. Its "Date:" under it is that signer's. On any other
form a bare "Signed:" is nobody's and nothing is placed (`formSides`, 2026-11-04).

A company client signs by its officer on the "Per: ____ / Authorized Signing Officer(s)"
lines. When every client on the signing side is a company in the reZEN deal (a company
name with no first or last name), Auto place puts their blocks on the Per lines that have
no party heading over them, and leaves the "Seller/Buyer" lines blank. A person, a mix, No
deal or a form without Per lines places as before. Never guessed from "Ltd." in a name
(`companyClients`, 0.4.0). Setting up an uploaded document on Prepare does the same, from
the deal attached on Real Signature's Transaction step; with none attached it places as
for a person.

```mermaid
flowchart TD
  A(["Deal picked, or No deal"]) --> D{"Is the deal buy side or<br/>listing side in reZEN?"}
  D -- yes --> D1["That side's clients sign"]
  D -- "dual, unknown or no deal" --> E{"Is the agent's email on the<br/>WEBForms form or Contacts<br/>as one side's agent?"}
  E -- yes --> E1["That side signs<br/>(both, if on both)"]
  E -- no --> TP{"Do the picked templates have<br/>blocks for one side only?"}
  TP -- yes --> T1["That side signs"]
  TP -- no --> LB{"Do the forms placed from their labels<br/>have signing lines for one side only?"}
  LB -- yes --> L1["That side signs"]
  LB -- no --> FN{"Do the form names point one way?<br/>Listing, Buyer, Seller, Purchaser, Tenant, Landlord,<br/>Cooperation Disclosure (seller)"}
  FN -- yes --> F1["That side signs"]
  FN -- no --> BOTH["Buyers and sellers both sign"]

  classDef q fill:#eaf0ff,stroke:#1d4ed8,color:#1b2433
  classDef out fill:#ffffff,stroke:#1b2433,color:#1b2433
  class D,E,TP,LB,FN q
  class A,D1,E1,T1,L1,F1,BOTH out
```

## 3. How many on the signing side

An empty slot is one click to delete in Real Signature; a missing one means placing its
blocks by hand. So the fallback is 2, but only once nothing better is known
(`signerCounts`; the WEBForms names from `partiesFromContacts` and `partiesFromFormValues`).

```mermaid
flowchart TD
  A(["For the buyers, then for the sellers"]) --> F{"Are names read in WEBForms?<br/>Contacts, or the buyer and seller<br/>lines on Alberta forms<br/>(a run-on line: '(operating as ...)', o/a,<br/>aka, trading as, formerly ... is the<br/>name above it, not another person)"}
  F -- yes --> F1["That many"]
  F -- no --> DL{"Does the picked deal list<br/>people on this side?"}
  DL -- yes --> D1["The deal's own count"]
  DL -- no --> TP{"Is a template picked?"}
  TP -- yes --> TS{"Does a picked template have<br/>more than 2 slots?"}
  TS -- yes --> T1["The template's number of slots"]
  TS -- no --> TWO["2"]
  TP -- no --> LB{"Does a form placed from its labels<br/>have just 1 line for this side?"}
  LB -- yes --> L1["1"]
  LB -- no --> TWO

  classDef q fill:#eaf0ff,stroke:#1d4ed8,color:#1b2433
  classDef out fill:#ffffff,stroke:#1b2433,color:#1b2433
  class F,DL,TP,TS,LB q
  class A,F1,D1,T1,L1,TWO out
```

Forms placed from their labels count the lines Auto place found when the forms came over
from WEBForms (`placedSummary` slots; a "Client" line counts for whichever side signs).
They settle the side before the form names do, and one line lowers the number to 1. More
lines than 2 never raise it: BC's contracts print three a side as room, not as three
people (Dan, 2026-11-04; 22 of 178 sample forms change, 9 Nov).

When the forms and the picked deal both count a side and differ, the panel says so under
the Buyers and Sellers boxes, with a button to use the other number (`countDisagreements`).
It never switches the number by itself, and a number typed by hand gets no note.

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
