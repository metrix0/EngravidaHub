// scripts/add-messages.mjs

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!SUPABASE_ANON_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

async function supabaseInsert(table, payload) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
    });

    const json = await response.json();

    if (!response.ok) {
        throw new Error(
            `Insert failed on ${table}: ${JSON.stringify(json, null, 2)}`
        );
    }

    return json[0];
}

function hoursAgo(hours, extraMinutes = 0) {
    const date = new Date();
    date.setHours(date.getHours() - hours);
    date.setMinutes(date.getMinutes() + extraMinutes);
    return date.toISOString();
}

function randomPhone() {
    return `+5519999${Math.floor(Math.random() * 9999999)
        .toString()
        .padStart(7, "0")}`;
}

async function main() {
    const phone = randomPhone();

    const client = await supabaseInsert("clients", {
        name: "Cliente Teste Mensagens",
        phone,
        email: null,
        external_ids: {
            blip_contact_id: `test-blip-${Date.now()}`,
            whatsapp_id: phone.replace(/\D/g, ""),
        },
        first_seen_at: hoursAgo(8, 0),
        last_interaction_at: hoursAgo(8, 10),
    });

    const messages = [
        {
            client_id: client.id,
            conversation_id: null,
            sender_type: "client",
            sender_name: "Cliente Teste",
            text: "Oi, queria agendar uma consulta online.",
            sent_at: hoursAgo(8, 0),
            sequence_index: 1,
        },
        {
            client_id: client.id,
            conversation_id: null,
            sender_type: "attendant",
            sender_name: "Atendente Teste",
            text: "Claro! A consulta online funciona como uma triagem inicial para entender seu caso.",
            sent_at: hoursAgo(8, 2),
            sequence_index: 2,
        },
        {
            client_id: client.id,
            conversation_id: null,
            sender_type: "client",
            sender_name: "Cliente Teste",
            text: "Estou tentando engravidar faz um tempo e queria ver as opções.",
            sent_at: hoursAgo(8, 5),
            sequence_index: 3,
        },
        {
            client_id: client.id,
            conversation_id: null,
            sender_type: "attendant",
            sender_name: "Atendente Teste",
            text: "Perfeito. A consulta custa R$ 200 e temos horário amanhã às 14h ou sexta às 10h.",
            sent_at: hoursAgo(8, 7),
            sequence_index: 4,
        },
        {
            client_id: client.id,
            conversation_id: null,
            sender_type: "client",
            sender_name: "Cliente Teste",
            text: "Amanhã às 14h pode ser.",
            sent_at: hoursAgo(8, 9),
            sequence_index: 5,
        },
        {
            client_id: client.id,
            conversation_id: null,
            sender_type: "attendant",
            sender_name: "Atendente Teste",
            text: "Ótimo, sua consulta online ficou agendada para amanhã às 14h.",
            sent_at: hoursAgo(8, 10),
            sequence_index: 6,
        },
    ];

    const insertedMessages = [];

    for (const message of messages) {
        insertedMessages.push(await supabaseInsert("messages", message));
    }

    console.log("Test client and messages inserted:");
    console.log({
        client_id: client.id,
        phone: client.phone,
        messages: insertedMessages.length,
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});