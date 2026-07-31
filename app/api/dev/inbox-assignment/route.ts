// app/api/dev/inbox-assignment/route.ts
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULTS = 50;
const MAX_ID_MATCHES = 200;

const THREAD_SELECT = `
    id,
    client_id,
    instagram_user_id,
    channel,
    status,
    assigned_attendant_id,
    queued_at,
    claimed_at,
    last_message_text,
    last_message_at,
    created_at,
    clients (
        id,
        name,
        phone,
        email
    ),
    instagram_user:instagram_users!thread_instagram_user_id_fkey (
        id,
        username,
        display_name,
        profile_picture_url
    ),
    attendants (
        id,
        name,
        email
    )
`;

type AssignmentRequest = {
    thread_id?: unknown;
    force?: unknown;
};

type SearchIdentityIds = {
    clientIds: string[];
    instagramUserIds: string[];
};

export async function GET(request: Request) {
    try {
        const access = await requireCurrentAttendant(false);
        if (!access.ok) return access.response;

        const { searchParams } = new URL(request.url);
        const rawSearch = searchParams.get("search")?.trim() ?? "";

        if (rawSearch.length < 3) {
            return NextResponse.json({
                ok: true,
                current_attendant: access.attendant,
                items: [],
            });
        }

        const identityIds = await searchIdentityIds(rawSearch);
        const rows = await findOpenThreads(identityIds);

        return NextResponse.json({
            ok: true,
            current_attendant: access.attendant,
            items: rows.map((row) => mapThread(row, access.attendant.id)),
        });
    } catch (error) {
        console.error("[dev-inbox-assignment] search failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível buscar as conversas.",
            },
            { status: 500 },
        );
    }
}

export async function POST(request: Request) {
    try {
        const access = await requireCurrentAttendant(true);
        if (!access.ok) return access.response;

        let body: AssignmentRequest;

        try {
            body = (await request.json()) as AssignmentRequest;
        } catch {
            return NextResponse.json(
                { ok: false, error: "O corpo da requisição não é um JSON válido." },
                { status: 400 },
            );
        }

        const threadId = String(body.thread_id ?? "").trim();
        const force = body.force === true;

        if (!threadId) {
            return NextResponse.json(
                { ok: false, error: "thread_id é obrigatório." },
                { status: 400 },
            );
        }

        const { data: thread, error: threadError } = await supabase
            .from("thread")
            .select(THREAD_SELECT)
            .eq("id", threadId)
            .maybeSingle();

        if (threadError) throw threadError;

        if (!thread || thread.status !== "open") {
            return NextResponse.json(
                { ok: false, error: "A conversa não está mais aberta." },
                { status: 404 },
            );
        }

        if (thread.assigned_attendant_id === access.attendant.id) {
            return NextResponse.json({
                ok: true,
                already_assigned: true,
                item: mapThread(thread, access.attendant.id),
            });
        }

        if (thread.assigned_attendant_id && !force) {
            const assigned = firstRelation(thread.attendants);

            return NextResponse.json(
                {
                    ok: false,
                    requires_confirmation: true,
                    error: assigned?.name
                        ? `Esta conversa está atribuída a ${assigned.name}.`
                        : "Esta conversa já está atribuída a outro atendente.",
                    assigned_to: assigned?.name ?? null,
                },
                { status: 409 },
            );
        }

        let updateQuery = supabase
            .from("thread")
            .update({
                assigned_attendant_id: access.attendant.id,
            })
            .eq("id", threadId)
            .eq("status", "open");

        if (!force) {
            updateQuery = updateQuery.is("assigned_attendant_id", null);
        }

        const { data: updated, error: updateError } = await updateQuery
            .select(THREAD_SELECT)
            .maybeSingle();

        if (updateError) throw updateError;

        if (!updated) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "A conversa foi atribuída por outra pessoa antes desta ação. Atualize a busca.",
                },
                { status: 409 },
            );
        }

        return NextResponse.json({
            ok: true,
            already_assigned: false,
            item: mapThread(updated, access.attendant.id),
        });
    } catch (error) {
        console.error("[dev-inbox-assignment] assignment failed", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível atribuir a conversa.",
            },
            { status: 500 },
        );
    }
}

async function requireCurrentAttendant(requireOnline: boolean) {
    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant) {
        return {
            ok: false as const,
            response: NextResponse.json(
                {
                    ok: false,
                    error: "O usuário atual não está vinculado a um atendente ativo.",
                },
                { status: 403 },
            ),
        };
    }

    if (requireOnline && !attendant.is_online) {
        return {
            ok: false as const,
            response: NextResponse.json(
                {
                    ok: false,
                    error: "O atendente precisa estar online para atribuir conversas.",
                },
                { status: 403 },
            ),
        };
    }

    return {
        ok: true as const,
        attendant,
    };
}

async function searchIdentityIds(rawSearch: string): Promise<SearchIdentityIds> {
    const safeText = sanitizeSearchText(rawSearch);
    const instagramText = sanitizeSearchText(rawSearch.replace(/^@+/, ""));
    const digits = rawSearch.replace(/\D/g, "");

    const [clientIds, instagramUserIds] = await Promise.all([
        searchClientIds({ safeText, digits }),
        searchInstagramUserIds(instagramText),
    ]);

    return { clientIds, instagramUserIds };
}

async function searchClientIds({
    safeText,
    digits,
}: {
    safeText: string;
    digits: string;
}) {
    const filters: string[] = [];

    if (digits.length >= 3) {
        filters.push(`phone.ilike.%${digits}%`);
    }

    if (safeText.length >= 3 && /[a-zA-ZÀ-ÿ]/.test(safeText)) {
        filters.push(`name.ilike.%${safeText}%`);
    }

    if (filters.length === 0) return [];

    const { data, error } = await supabase
        .from("clients")
        .select("id")
        .or(filters.join(","))
        .limit(MAX_ID_MATCHES);

    if (error) throw error;

    return (data ?? []).map((client) => client.id);
}

async function searchInstagramUserIds(searchText: string) {
    if (searchText.length < 3) return [];

    const { data, error } = await supabase
        .from("instagram_users")
        .select("id")
        .or(
            `username.ilike.%${searchText}%,display_name.ilike.%${searchText}%`,
        )
        .limit(MAX_ID_MATCHES);

    if (error) throw error;

    return (data ?? []).map((user) => user.id);
}

async function findOpenThreads({
    clientIds,
    instagramUserIds,
}: SearchIdentityIds) {
    const resultSets = await Promise.all([
        clientIds.length > 0
            ? findOpenThreadsForIdentity("client_id", clientIds)
            : Promise.resolve([]),
        instagramUserIds.length > 0
            ? findOpenThreadsForIdentity(
                  "instagram_user_id",
                  instagramUserIds,
              )
            : Promise.resolve([]),
    ]);
    const byThreadId = new Map<string, any>();

    for (const rows of resultSets) {
        for (const row of rows) {
            byThreadId.set(row.id, row);
        }
    }

    return Array.from(byThreadId.values())
        .sort(
            (left, right) =>
                threadTimestamp(right) - threadTimestamp(left),
        )
        .slice(0, MAX_RESULTS);
}

async function findOpenThreadsForIdentity(
    column: "client_id" | "instagram_user_id",
    ids: string[],
) {
    const { data, error } = await supabase
        .from("thread")
        .select(THREAD_SELECT)
        .eq("status", "open")
        .in(column, ids)
        .order("last_message_at", {
            ascending: false,
            nullsFirst: false,
        })
        .limit(MAX_RESULTS);

    if (error) throw error;
    return data ?? [];
}

function sanitizeSearchText(value: string) {
    return value
        .replace(/[,%()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapThread(row: any, currentAttendantId: string) {
    const client = firstRelation(row.clients);
    const instagramUser = firstRelation(row.instagram_user);
    const assigned = firstRelation(row.attendants);
    const isInstagram =
        row.channel === "Instagram" || Boolean(row.instagram_user_id);
    const assignmentStatus = !row.assigned_attendant_id
        ? "unassigned"
        : row.assigned_attendant_id === currentAttendantId
            ? "mine"
            : "other";
    const instagramUsername =
        instagramUser?.username?.trim().replace(/^@+/, "") || null;
    const instagramDisplayName = instagramUser?.display_name?.trim() || null;

    return {
        id: row.id,
        client_id: row.client_id ?? null,
        instagram_user_id: row.instagram_user_id ?? null,
        channel: isInstagram ? "Instagram" : "WhatsApp",
        name: isInstagram
            ? instagramDisplayName ||
              (instagramUsername ? `@${instagramUsername}` : null) ||
              "Usuário do Instagram"
            : client?.name ?? "Cliente sem nome",
        username: instagramUsername,
        profile_picture_url: instagramUser?.profile_picture_url ?? null,
        phone: client?.phone ?? null,
        email: client?.email ?? null,
        preview: cleanMessageText(row.last_message_text ?? "Sem mensagens"),
        last_message_at: row.last_message_at ?? row.created_at,
        queued_at: row.queued_at ?? null,
        claimed_at: row.claimed_at ?? null,
        assigned_attendant_id: row.assigned_attendant_id ?? null,
        assigned_attendant_name: assigned?.name ?? null,
        assignment_status: assignmentStatus,
    };
}

function threadTimestamp(row: {
    last_message_at?: string | null;
    created_at?: string | null;
}) {
    const value = row.last_message_at ?? row.created_at;
    if (!value) return 0;

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function cleanMessageText(value: string) {
    return value
        .replace(/<\/?b>/gi, "")
        .replace(/<\/?strong>/gi, "")
        .trim();
}
