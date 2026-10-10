// Invented data only. Never paste a real template, deal or address here.

export function sampleTemplate() {
  return {
    id: "tmpl-sample-1",
    name: "Sample Purchase Contract",
    type: "USER_PDF",
    pagesCount: 3,
    defaults: {
      transactionId: "tx-sample",
      signees: [{ name: "Jordan Sample", email: "jordan@example.com", signeeType: "BUYER", signeeIndex: 0, signOrder: 1 }],
      sender: { firstName: "Alex", lastName: "Example", email: "alex@example.com" },
      emailSubject: "Please sign",
      emailBody: "Hi Jordan",
    },
    signeeConfigs: [
      { signeeType: "BUYER", minNum: 1, maxNum: 2 },
      { signeeType: "SELLER", minNum: 1, maxNum: 2 },
    ],
    fieldDefinitions: [
      { index: 0, type: "INITIALS", signeeType: "BUYER", signeeIndex: 0, fieldLocations: [{ pageNum: 0, position: [500, 750, 40, 20] }] },
      { index: 1, type: "INITIALS", signeeType: "BUYER", signeeIndex: 1, fieldLocations: [{ pageNum: 0, position: [550, 750, 40, 20] }] },
      { index: 2, type: "SIGNATURE", signeeType: "SELLER", signeeIndex: 0, fieldLocations: [{ pageNum: 2, position: [100, 600, 200, 30] }] },
      { index: 3, type: "SIGNATURE", signeeType: "BUYER", signeeIndex: 1, fieldLocations: [{ pageNum: 2, position: [100, 650, 200, 30] }] },
      { index: 4, type: "SIGNED_DATE", signeeType: "BUYER", signeeIndex: 0, fieldLocations: [{ pageNum: 2, position: [350, 650, 80, 20] }] },
    ],
    documentFieldValidations: [
      { fieldIndex: 2, validationType: "REQUIRED" },
      { fieldIndex: 3, validationType: "REQUIRED" },
      { fieldIndex: 4, validationType: "REQUIRED" },
    ],
  };
}

export const sampleDeals = [
  { id: "d1", address: "120 Example Street NW", agentName: "Alex Example" },
  { id: "d2", address: "12 Sample Avenue SW", agentName: "Casey Placeholder" },
  { id: "d3", address: "\t120 Example Crescent SE", agentName: "Alex Example" },
];
