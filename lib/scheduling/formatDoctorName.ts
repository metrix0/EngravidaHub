// lib/scheduling/formatDoctorName.ts
const PARTICLES = new Set(["da", "das", "de", "do", "dos", "e"]);

export function formatDoctorName(value: string) {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized) return "—";
    const title = /^(dr(?:a)?\.?)\s+/i.exec(normalized);
    const name = title ? normalized.slice(title[0].length) : normalized;
    const formatted = name.toLocaleLowerCase("pt-BR").split(" ").map((word, index) =>
        index > 0 && PARTICLES.has(word) ? word : word.replace(/(^|[-'])\p{L}/gu, letter => letter.toLocaleUpperCase("pt-BR")),
    ).join(" ");
    return `${title?.[1].toLowerCase().startsWith("dra") ? "Dra. " : "Dr. "}${formatted}`;
}
