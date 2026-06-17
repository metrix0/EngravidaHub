// components/dashboard/MainFilters.tsx
"use client";

import { Eye, MapPin, TrainTrack, User } from "lucide-react";

import FilterButton, {
    type FilterOption,
} from "@/components/ui/FilterButton";

type MainFilterKey = "units" | "attendants" | "tunnels" | "origins";

type MainFiltersProps = {
    units?: FilterOption[];
    attendants?: FilterOption[];
    tunnels?: FilterOption[];
    origins?: FilterOption[];

    unitValues?: string[];
    setUnitValues?: (values: string[]) => void;

    attendantValues?: string[];
    setAttendantValues?: (values: string[]) => void;

    tunnelValues?: string[];
    setTunnelValues?: (values: string[]) => void;

    originValues?: string[];
    setOriginValues?: (values: string[]) => void;

    show?: Partial<Record<MainFilterKey, boolean>>;
    widths?: Partial<Record<MainFilterKey, string>>;
};

export function MainFilters({
    units = [],
    attendants = [],
    tunnels = [],
    origins = [],

    unitValues = [],
    setUnitValues,

    attendantValues = [],
    setAttendantValues,

    tunnelValues = [],
    setTunnelValues,

    originValues = [],
    setOriginValues,

    show,
    widths,
}: MainFiltersProps) {
    const showUnits = shouldShowFilter("units", show, setUnitValues);
    const showAttendants = shouldShowFilter(
        "attendants",
        show,
        setAttendantValues,
    );
    const showTunnels = shouldShowFilter("tunnels", show, setTunnelValues);
    const showOrigins = shouldShowFilter("origins", show, setOriginValues);

    return (
        <>
            {showUnits && (
                <FilterButton
                    icon={<MapPin size={16} />}
                    label="Todas as unidades"
                    values={setUnitValues ? unitValues : undefined}
                    onChange={setUnitValues}
                    options={units}
                    widthClassName={widths?.units ?? "w-[230px]"}
                />
            )}

            {showAttendants && (
                <FilterButton
                    icon={<User size={16} />}
                    label="Todos os atendentes"
                    values={setAttendantValues ? attendantValues : undefined}
                    onChange={setAttendantValues}
                    options={attendants}
                    widthClassName={widths?.attendants ?? "w-[230px]"}
                />
            )}

            {showTunnels && (
                <FilterButton
                    icon={<TrainTrack size={16} />}
                    label="Todos os túneis"
                    values={setTunnelValues ? tunnelValues : undefined}
                    onChange={setTunnelValues}
                    options={tunnels}
                    widthClassName={widths?.tunnels ?? "w-[220px]"}
                />
            )}

            {showOrigins && (
                <FilterButton
                    icon={<Eye size={16} />}
                    label="Todas as origens"
                    values={setOriginValues ? originValues : undefined}
                    onChange={setOriginValues}
                    options={origins}
                    widthClassName={widths?.origins ?? "w-[220px]"}
                />
            )}
        </>
    );
}

function shouldShowFilter(
    key: MainFilterKey,
    show: Partial<Record<MainFilterKey, boolean>> | undefined,
    onChange: ((values: string[]) => void) | undefined,
) {
    if (show?.[key] === false) return false;
    if (show?.[key] === true) return true;

    return Boolean(onChange);
}
