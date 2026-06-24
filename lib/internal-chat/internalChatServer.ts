// lib/internal-chat/internalChatServer.ts
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/lib";
import type { InternalChatUser } from "@/types/internalChat";

const ONLINE_WINDOW_MS = 90_000;

type PermissionRow = {
    auth_user_id: string;
    preset: string;
    active: boolean;
};

type AttendantRow = {
    auth_user_id: string | null;
    name: string;
};

type PresenceRow = {
    auth_user_id: string;
    last_seen_at: string;
};

export async function getInternalChatUsers({
    excludeUserId,
}: {
    excludeUserId?: string | null;
} = {}): Promise<InternalChatUser[]> {
    const [authUsersResult, permissionsResult, attendantsResult, presenceResult] =
        await Promise.all([
            supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
            supabase
                .from("user_permissions")
                .select("auth_user_id, preset, active"),
            supabase
                .from("attendants")
                .select("auth_user_id, name"),
            supabase
                .from("user_presence")
                .select("auth_user_id, last_seen_at"),
        ]);

    if (authUsersResult.error) throw authUsersResult.error;
    if (permissionsResult.error) throw permissionsResult.error;
    if (attendantsResult.error) throw attendantsResult.error;
    if (presenceResult.error) throw presenceResult.error;

    const permissions = new Map(
        ((permissionsResult.data ?? []) as PermissionRow[]).map((row) => [
            row.auth_user_id,
            row,
        ]),
    );
    const attendants = new Map(
        ((attendantsResult.data ?? []) as AttendantRow[])
            .filter((row) => row.auth_user_id)
            .map((row) => [row.auth_user_id!, row]),
    );
    const presences = new Map(
        ((presenceResult.data ?? []) as PresenceRow[]).map((row) => [
            row.auth_user_id,
            row,
        ]),
    );

    const now = Date.now();

    return authUsersResult.data.users
        .filter((user) => user.id !== excludeUserId)
        .map((user) => {
            const permission = permissions.get(user.id) ?? null;
            const attendant = attendants.get(user.id) ?? null;
            const presence = presences.get(user.id) ?? null;
            const lastSeenAt = presence?.last_seen_at ?? null;
            const online = Boolean(
                lastSeenAt && now - new Date(lastSeenAt).getTime() <= ONLINE_WINDOW_MS,
            );

            return {
                id: user.id,
                email: user.email ?? null,
                name: attendant?.name ?? getAuthUserName(user),
                preset: permission?.preset ?? null,
                attendant_name: attendant?.name ?? null,
                active: permission?.active ?? true,
                online,
                last_seen_at: lastSeenAt,
            } satisfies InternalChatUser;
        })
        .sort((first, second) => {
            if (first.online !== second.online) return first.online ? -1 : 1;
            return first.name.localeCompare(second.name, "pt-BR");
        });
}

export async function getInternalChatUserById(
    userId: string,
): Promise<InternalChatUser | null> {
    const users = await getInternalChatUsers();
    return users.find((user) => user.id === userId) ?? null;
}

export async function requireInternalConversationParticipant({
    conversationId,
    authUserId,
}: {
    conversationId: string;
    authUserId: string;
}) {
    const { data, error } = await supabase
        .from("internal_conversations")
        .select("*")
        .eq("id", conversationId)
        .or(`user_a_id.eq.${authUserId},user_b_id.eq.${authUserId}`)
        .maybeSingle();

    if (error) throw error;
    return data;
}

export function getPeerUserId(
    conversation: { user_a_id: string; user_b_id: string },
    currentUserId: string,
) {
    return conversation.user_a_id === currentUserId
        ? conversation.user_b_id
        : conversation.user_a_id;
}

export function makeParticipantKey(firstUserId: string, secondUserId: string) {
    return [firstUserId, secondUserId].sort().join(":");
}

function getAuthUserName(user: User) {
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;

    return (
        getMetadataString(metadata, "name") ??
        getMetadataString(metadata, "full_name") ??
        getMetadataString(metadata, "display_name") ??
        getMetadataString(metadata, "user_name") ??
        user.email?.split("@")[0] ??
        "Usuário"
    );
}

function getMetadataString(
    metadata: Record<string, unknown>,
    key: string,
) {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
