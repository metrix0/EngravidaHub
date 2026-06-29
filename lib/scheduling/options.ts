// lib/scheduling/options.ts

export const SCHEDULING_DURATION_OPTIONS = [30, 45, 60, 90, 120].map(
    (minutes) => ({
        value: String(minutes),
        label: `${minutes} min`,
    }),
);

export const SCHEDULING_PROCEDURE_OPTIONS = [
    { value: "Consulta", label: "Consulta" },
    { value: "Consulta inicial", label: "Consulta inicial" },
    { value: "Retorno", label: "Retorno" },
    { value: "Ultrassom", label: "Ultrassom" },
    { value: "Coleta de óvulos", label: "Coleta de óvulos" },
    { value: "Transferência embrionária", label: "Transferência embrionária" },
];

export function getSchedulingProcedureOptions(currentValue?: string) {
    const value = currentValue?.trim();
    if (!value) return SCHEDULING_PROCEDURE_OPTIONS;

    const exists = SCHEDULING_PROCEDURE_OPTIONS.some(
        (option) => option.value.toLocaleLowerCase("pt-BR") === value.toLocaleLowerCase("pt-BR"),
    );

    return exists
        ? SCHEDULING_PROCEDURE_OPTIONS
        : [{ value, label: value }, ...SCHEDULING_PROCEDURE_OPTIONS];
}
