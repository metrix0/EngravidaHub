// lib/invoices/matchDoctor.ts
export type DoctorReference = {
    id: string;
    name: string;
};

const IGNORED_TOKENS = new Set([
    "da",
    "das",
    "de",
    "do",
    "dos",
    "dr",
    "dra",
    "doutor",
    "doutora",
    "e",
]);

export function findDoctorBySourceName(
    sourceName: string | null | undefined,
    doctors: readonly DoctorReference[],
) {
    const sourceTokens = new Set(doctorTokens(sourceName));
    if (sourceTokens.size === 0) return null;

    const matches = doctors
        .map((doctor) => ({
            doctor,
            tokens: doctorTokens(doctor.name),
        }))
        .filter(
            ({ tokens }) =>
                tokens.length > 0 &&
                tokens.every((token) => sourceTokens.has(token)),
        )
        .sort((first, second) => second.tokens.length - first.tokens.length);

    if (matches.length === 0) return null;

    const bestTokenCount = matches[0].tokens.length;
    const bestMatches = matches.filter(
        (match) => match.tokens.length === bestTokenCount,
    );

    return bestMatches.length === 1 ? bestMatches[0].doctor : null;
}

function doctorTokens(value: string | null | undefined) {
    return normalizeText(value)
        .split(" ")
        .filter(
            (token) =>
                token.length > 1 &&
                !IGNORED_TOKENS.has(token) &&
                token !== "externo",
        );
}

function normalizeText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
