// lib/internal-chat/internalChatServer.ts
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/lib";
import type {
  InternalChatUser,
  InternalGroupSummary,
} from "@/types/internalChat";

const ONLINE_WINDOW_MS = 90_000;

type PermissionRow = {
  auth_user_id: string;
  preset: string;
  active: boolean;
};

type AttendantRow = {
  auth_user_id: string | null;
  name: string;
  queue_id: string | null;
  is_online: boolean;
};

type QueueRow = {
  id: string;
  name: string;
};

type PresenceRow = {
  auth_user_id: string;
  last_seen_at: string;
};

type InternalGroupRow = {
  id: string;
  queue_id: string | null;
  name: string;
  last_message_text: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

type InternalGroupMemberRow = {
  group_id: string;
  auth_user_id: string;
  automatic: boolean;
  manual: boolean;
  unread_count: number;
  last_read_at: string | null;
};

export async function getInternalChatUsers({
  excludeUserId,
}: {
  excludeUserId?: string | null;
} = {}): Promise<InternalChatUser[]> {
  const [
    authUsersResult,
    permissionsResult,
    attendantsResult,
    queuesResult,
    presenceResult,
  ] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("user_permissions").select("auth_user_id, preset, active"),
    supabase
      .from("attendants")
      .select("auth_user_id, name, queue_id, is_online"),
    supabase.from("queues").select("id, name"),
    supabase.from("user_presence").select("auth_user_id, last_seen_at"),
  ]);

  if (authUsersResult.error) throw authUsersResult.error;
  if (permissionsResult.error) throw permissionsResult.error;
  if (attendantsResult.error) throw attendantsResult.error;
  if (queuesResult.error) throw queuesResult.error;
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
  const queues = new Map(
    ((queuesResult.data ?? []) as QueueRow[]).map((row) => [row.id, row]),
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
      const heartbeatOnline = Boolean(
        lastSeenAt && now - new Date(lastSeenAt).getTime() <= ONLINE_WINDOW_MS,
      );
      // Linked attendants already have an explicit CRM online/offline state.
      // Presence is only the fallback for users without an attendant record.
      const online = attendant ? Boolean(attendant.is_online) : heartbeatOnline;

      return {
        id: user.id,
        email: user.email ?? null,
        name: attendant?.name ?? getAuthUserName(user),
        preset: permission?.preset ?? null,
        attendant_name: attendant?.name ?? null,
        queue_name: attendant?.queue_id
          ? (queues.get(attendant.queue_id)?.name ?? null)
          : null,
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

export async function getInternalUserNamesByIds(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();

  const users = await getInternalChatUsers();
  const requested = new Set(userIds);

  return new Map(
    users
      .filter((user) => requested.has(user.id))
      .map((user) => [user.id, user.name]),
  );
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

export async function requireInternalGroupMember({
  groupId,
  authUserId,
}: {
  groupId: string;
  authUserId: string;
}) {
  const { data: member, error: memberError } = await supabase
    .from("internal_group_members")
    .select(
      "group_id, auth_user_id, automatic, manual, unread_count, last_read_at",
    )
    .eq("group_id", groupId)
    .eq("auth_user_id", authUserId)
    .or("automatic.eq.true,manual.eq.true")
    .maybeSingle();

  if (memberError) throw memberError;
  if (!member) return null;

  const { data: group, error: groupError } = await supabase
    .from("internal_groups")
    .select("*")
    .eq("id", groupId)
    .eq("active", true)
    .maybeSingle();

  if (groupError) throw groupError;
  if (!group) return null;

  return {
    group: group as InternalGroupRow,
    member: member as InternalGroupMemberRow,
  };
}

export async function getInternalGroupSummaries(
  authUserId: string,
): Promise<InternalGroupSummary[]> {
  const { data: memberships, error: membershipsError } = await supabase
    .from("internal_group_members")
    .select(
      "group_id, auth_user_id, automatic, manual, unread_count, last_read_at",
    )
    .eq("auth_user_id", authUserId)
    .or("automatic.eq.true,manual.eq.true");

  if (membershipsError) throw membershipsError;

  const memberRows = (memberships ?? []) as InternalGroupMemberRow[];
  const groupIds = memberRows.map((membership) => membership.group_id);
  if (groupIds.length === 0) return [];

  const [groupsResult, allMembersResult] = await Promise.all([
    supabase
      .from("internal_groups")
      .select(
        "id, queue_id, name, last_message_text, last_message_at, created_at, updated_at",
      )
      .in("id", groupIds)
      .eq("active", true),
    supabase
      .from("internal_group_members")
      .select("group_id, auth_user_id, automatic, manual")
      .in("group_id", groupIds)
      .or("automatic.eq.true,manual.eq.true"),
  ]);

  if (groupsResult.error) throw groupsResult.error;
  if (allMembersResult.error) throw allMembersResult.error;

  const allMemberRows = (allMembersResult.data ?? []) as Array<
    Pick<
      InternalGroupMemberRow,
      "group_id" | "auth_user_id" | "automatic" | "manual"
    >
  >;
  const memberNamesById = await getInternalUserNamesByIds([
    ...new Set(allMemberRows.map((row) => row.auth_user_id)),
  ]);
  const membersByGroup = new Map<string, Array<{ id: string; name: string }>>();

  for (const row of allMemberRows) {
    const current = membersByGroup.get(row.group_id) ?? [];
    current.push({
      id: row.auth_user_id,
      name: memberNamesById.get(row.auth_user_id) ?? "Usuário",
    });
    membersByGroup.set(row.group_id, current);
  }

  for (const members of membersByGroup.values()) {
    members.sort((first, second) =>
      first.name.localeCompare(second.name, "pt-BR"),
    );
  }

  const membershipByGroup = new Map(
    memberRows.map((membership) => [membership.group_id, membership]),
  );

  return ((groupsResult.data ?? []) as InternalGroupRow[])
    .map((group) => {
      const members = membersByGroup.get(group.id) ?? [];

      return {
        id: group.id,
        queue_id: group.queue_id,
        name: group.name,
        member_count: members.length,
        members,
        last_message_text: group.last_message_text,
        last_message_at: group.last_message_at,
        unread_count: membershipByGroup.get(group.id)?.unread_count ?? 0,
        created_at: group.created_at,
        updated_at: group.updated_at,
      };
    })
    .sort((first, second) => {
      const firstTime = first.last_message_at
        ? new Date(first.last_message_at).getTime()
        : 0;
      const secondTime = second.last_message_at
        ? new Date(second.last_message_at).getTime()
        : 0;
      if (firstTime !== secondTime) return secondTime - firstTime;
      return first.name.localeCompare(second.name, "pt-BR");
    });
}

export async function getInternalGroupSummaryById({
  groupId,
  authUserId,
}: {
  groupId: string;
  authUserId: string;
}) {
  const groups = await getInternalGroupSummaries(authUserId);
  return groups.find((group) => group.id === groupId) ?? null;
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

export function getCurrentAuthUserName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  const metadata = user.user_metadata ?? {};

  return (
    getMetadataString(metadata, "name") ??
    getMetadataString(metadata, "full_name") ??
    getMetadataString(metadata, "display_name") ??
    getMetadataString(metadata, "user_name") ??
    user.email?.split("@")[0] ??
    "Usuário"
  );
}

function getAuthUserName(user: User) {
  return getCurrentAuthUserName(user);
}

function getMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
