// lib/active-messages/presetAccess.ts
export const ACTIVE_MESSAGE_ALLOWED_PRESETS = [
    "admin",
    "atendente",
    "marketing",
] as const;

export type ActiveMessageAllowedPreset =
    (typeof ACTIVE_MESSAGE_ALLOWED_PRESETS)[number];

export function canPresetAccessActiveMessages(
    preset: unknown,
): preset is ActiveMessageAllowedPreset {
    return (
        typeof preset === "string" &&
        ACTIVE_MESSAGE_ALLOWED_PRESETS.includes(
            preset as ActiveMessageAllowedPreset,
        )
    );
}

export function sanitizeActiveMessageTabs<T extends string>(
    preset: unknown,
    tabs: readonly T[],
): T[] {
    const uniqueTabs = [...new Set(tabs)];

    return canPresetAccessActiveMessages(preset)
        ? uniqueTabs
        : uniqueTabs.filter((tab) => tab !== "mensagem_ativa");
}
