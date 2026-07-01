// lib/users/formatSystemUserName.ts
export function formatSystemUserName(value: string | null | undefined) {
    const normalized = value?.trim();
    if (!normalized) return "Usuário";

    const isEmail = normalized.includes("@");
    const namePart = isEmail
        ? normalized.slice(0, normalized.indexOf("@"))
        : normalized;

    if (!isEmail && !namePart.includes(".")) {
        return namePart;
    }

    return namePart
        .split(".")
        .map((part) => part.trim())
        .filter(Boolean)
        .map(
            (part) =>
                part.charAt(0).toLocaleUpperCase("pt-BR") +
                part.slice(1).toLocaleLowerCase("pt-BR"),
        )
        .join(" ");
}
