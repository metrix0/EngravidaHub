// scripts/test-blip-ticket-messages.mjs

const BLIP_CONTRACT_ID = process.env.BLIP_CONTRACT_ID;
const BLIP_AUTH_KEY = process.env.BLIP_AUTH_KEY;
const BLIP_TICKET_ID = "368892"

if (!BLIP_CONTRACT_ID) throw new Error("Missing BLIP_CONTRACT_ID");
if (!BLIP_AUTH_KEY) throw new Error("Missing BLIP_AUTH_KEY");
if (!BLIP_TICKET_ID) throw new Error("Missing BLIP_TICKET_ID");

const response = await fetch(
    `https://${BLIP_CONTRACT_ID}.http.msging.net/commands`,
    {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Key ${BLIP_AUTH_KEY}`,
        },
        body: JSON.stringify({
            id: crypto.randomUUID(),
            method: "get",
            uri: `/tickets/${BLIP_TICKET_ID}/messages`,
        }),
    }
);

const json = await response.json();

console.log(JSON.stringify(json, null, 2));

if (!response.ok) {
    process.exit(1);
}