import {
  getServerTabAccess,
  type ServerTabAccess,
} from "@/lib/auth/getServerTabAccess";

export async function getUnitMacroAccess(): Promise<ServerTabAccess> {
  const access = await getServerTabAccess("dashboard");
  if (access.ok === false) return access;
  if (
    access.permission.unit_lock ||
    !access.permission.allowed_tabs.includes("assistente")
  ) {
    return {
      ok: false,
      status: 403,
      error:
        "A análise macro requer acesso geral ao Dashboard e ao Assistente.",
    };
  }
  return access;
}
