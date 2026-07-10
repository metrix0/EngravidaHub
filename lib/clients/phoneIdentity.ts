// lib/clients/phoneIdentity.ts
export function normalizePhoneIdentity(value: string | null | undefined) {
    if (!value) return null;
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (!digits) return null;
    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function extractPhoneIdentityFromExternalContactId(value: string | null | undefined) {
    return value ? normalizePhoneIdentity(value.split("@", 1)[0]) : null;
}
