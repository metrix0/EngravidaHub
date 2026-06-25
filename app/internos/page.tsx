// app/internos/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, UsersRound } from "lucide-react";

import {
  AdvancedFilterButton,
  DataTable,
  HoverBadgeList,
  SidePanel,
  Skeleton,
  TableHeaderPreset,
  type DataTableColumn,
  type HoverBadgeListItem,
} from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import {
  openInternalChat,
  openInternalGroup,
} from "@/components/conversations/FloatingConversationPanel";
import {
  fetchInternalGroups,
  fetchInternalUsers,
} from "@/lib/internal-chat/internalChatApi";
import type {
  InternalChatUser,
  InternalGroupSummary,
} from "@/types/internalChat";

const REFRESH_INTERVAL_MS = 15_000;

type RoleId = "admin" | "gestor" | "atendente" | "marketing";

type RoleBadgeInfo = {
  label: string;
  className: string;
};

const ROLE_BADGES: Record<RoleId, RoleBadgeInfo> = {
  admin: {
    label: "Admin",
    className: "bg-red-soft text-red",
  },
  gestor: {
    label: "Gestor",
    className: "bg-blue-soft text-blue",
  },
  atendente: {
    label: "Atendente",
    className: "bg-green-soft text-green",
  },
  marketing: {
    label: "Marketing",
    className: "bg-orange-soft text-orange",
  },
};

export default function InternosPage() {
  const [users, setUsers] = useState<InternalChatUser[]>([]);
  const [groups, setGroups] = useState<InternalGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [statusValues, setStatusValues] = useState<string[]>([]);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);

    try {
      setError(null);
      const [nextUsers, nextGroups] = await Promise.all([
        fetchInternalUsers(),
        fetchInternalGroups(),
      ]);
      setUsers(nextUsers);
      setGroups(nextGroups);
    } catch (loadError) {
      console.error("[internos] failed to load", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar os chats internos",
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();

    const interval = window.setInterval(
      () => void loadData({ silent: true }),
      REFRESH_INTERVAL_MS,
    );

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void loadData({ silent: true });
      }
    }

    function handleAttendantStatusChanged() {
      void loadData({ silent: true });
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(
      "attendant-status-changed",
      handleAttendantStatusChanged,
    );

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(
        "attendant-status-changed",
        handleAttendantStatusChanged,
      );
    };
  }, [loadData]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();

    return users.filter((user) => {
      if (statusValues.length > 0) {
        const value = user.online ? "online" : "offline";
        if (!statusValues.includes(value)) return false;
      }

      if (!term) return true;

      const role = getRoleBadge(user.preset);

      return [
        user.name,
        user.email,
        user.queue_name,
        role?.label,
        user.online ? "online" : "offline",
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [search, statusValues, users]);

  const filteredGroups = useMemo(() => {
    const term = groupSearch.trim().toLowerCase();
    if (!term) return groups;

    return groups.filter((group) =>
      [
        group.name,
        group.last_message_text,
        ...(group.members ?? []).map((member) => member.name),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [groupSearch, groups]);

  const userColumns: DataTableColumn<InternalChatUser>[] = [
    {
      id: "user",
      label: "Usuário",
      width: "45%",
      render: (user) => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <InitialsAvatar name={user.name} />
            <span
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                user.online ? "bg-green" : "bg-slate-400"
              }`}
              title={user.online ? "Online" : "Offline"}
            />
          </div>

          <div className="min-w-0">
            <div className="truncate font-medium text-slate-700">
              {user.name}
            </div>
            <div className="mt-1 truncate text-xs text-muted">
              {user.email ?? "Sem e-mail"}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "queue",
      label: "Fila",
      width: "28%",
      render: (user) => (
        <span
          title={user.queue_name ?? "—"}
          className={`block truncate ${
            user.queue_name ? "text-slate-700" : "text-slate-400"
          }`}
        >
          {user.queue_name ?? "—"}
        </span>
      ),
    },
    {
      id: "role",
      label: "Função",
      width: "20%",
      render: (user) => {
        const role = getRoleBadge(user.preset);

        return role ? (
          <RoleBadge role={role} />
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      id: "action",
      label: "",
      width: "7%",
      align: "right",
      render: () => (
        <span className="inline-flex text-slate-400 transition-colors hover:text-slate-700">
          <MessageCircle size={17} />
        </span>
      ),
    },
  ];

  const groupColumns: DataTableColumn<InternalGroupSummary>[] = [
    {
      id: "group",
      label: "Grupo",
      width: "32%",
      render: (group) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-soft text-purple">
            <UsersRound size={17} />
          </span>

          <div className="min-w-0">
            <div className="truncate font-medium text-slate-700">
              {group.name}
            </div>
            <div className="mt-1 truncate text-xs text-muted">
              Grupo interno da fila
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "members",
      label: "Participantes",
      width: "38%",
      render: (group) => {
        const items: HoverBadgeListItem[] = (group.members ?? []).map(
          (member) => ({
            key: member.id,
            label: member.name,
            className: "bg-purple-soft text-purple",
          }),
        );

        return (
          <HoverBadgeList
            items={items}
            emptyLabel="—"
            badgeClassName="rounded-md px-2.5 py-1 text-xs font-bold"
            maxBadgeWidthClassName="max-w-[130px]"
            expandedBadgeClassName="max-w-none"
            popupMaxWidthClassName="max-w-[620px]"
            className="inline-flex w-fit max-w-full"
          />
        );
      },
    },
    {
      id: "last_message",
      label: "Última mensagem",
      width: "22%",
      render: (group) => (
        <span
          title={group.last_message_text ?? "Nenhuma mensagem"}
          className="block truncate text-slate-500"
        >
          {group.last_message_text ?? "Nenhuma mensagem"}
        </span>
      ),
    },
    {
      id: "unread",
      label: "",
      width: "4%",
      align: "right",
      render: (group) =>
        group.unread_count > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
            {group.unread_count > 99 ? "99+" : group.unread_count}
          </span>
        ) : null,
    },
    {
      id: "action",
      label: "",
      width: "4%",
      align: "right",
      render: () => (
        <span className="inline-flex text-slate-400 transition-colors hover:text-slate-700">
          <MessageCircle size={17} />
        </span>
      ),
    },
  ];

  return (
    <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
      <SidePanel />

      <section className="min-w-0 flex-1 px-8 pt-8 pb-16">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            Internos
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Converse diretamente com outros usuários do sistema
          </p>
        </header>

        {error ? (
          <div className="mb-6 rounded-2xl border border-red/20 bg-red-soft px-5 py-4 text-sm font-bold text-red">
            {error}
          </div>
        ) : null}

        <section>
          <TableHeaderPreset
            title="Usuários"
            count={filteredUsers.length}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Buscar usuário, fila ou função..."
          >
            <AdvancedFilterButton
              sections={[
                {
                  id: "status",
                  title: "Status",
                  values: statusValues,
                  onChange: setStatusValues,
                  options: [
                    { label: "Online", value: "online" },
                    { label: "Offline", value: "offline" },
                  ],
                },
              ]}
            />
          </TableHeaderPreset>

          {loading ? (
            <InternosTableSkeleton />
          ) : (
            <DataTable
              columns={userColumns}
              rows={filteredUsers}
              getRowKey={(user) => user.id}
              onRowClick={(user) =>
                openInternalChat(user.id, {
                  name: user.name,
                  email: user.email,
                  online: user.online,
                })
              }
              emptyMessage="Nenhum usuário encontrado."
            />
          )}
        </section>

        <section className="mt-10">
          <TableHeaderPreset
            title="Grupos"
            count={filteredGroups.length}
            searchValue={groupSearch}
            onSearchChange={setGroupSearch}
            searchPlaceholder="Buscar grupo ou participante..."
          />

          {loading ? (
            <InternosTableSkeleton rows={5} />
          ) : (
            <DataTable
              columns={groupColumns}
              rows={filteredGroups}
              getRowKey={(group) => group.id}
              onRowClick={(group) =>
                openInternalGroup(group.id, {
                  name: group.name,
                })
              }
              emptyMessage="Você ainda não participa de nenhum grupo."
            />
          )}
        </section>
          <div className={"pt-16"}></div>
      </section>
    </main>
  );
}

function getRoleBadge(value: string | null): RoleBadgeInfo | null {
  if (!value || value === "__none__") return null;
  return ROLE_BADGES[value as RoleId] ?? null;
}

function RoleBadge({ role }: { role: RoleBadgeInfo }) {
  return (
    <span
      className={`inline-flex max-w-full truncate rounded-md px-2.5 py-1 text-xs font-bold ${role.className}`}
    >
      {role.label}
    </span>
  );
}

function InternosTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-6 py-5">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-[68px] rounded-xl" />
      ))}
    </div>
  );
}
