// components/ui/SingleFilterButton.tsx
"use client";

import FilterButton, { type FilterButtonProps } from "./FilterButton";

// Keeps the FilterButton appearance and array-based filter contract, but each
// option applies immediately and the selection is limited to one unit.
export default function SingleFilterButton(props: Omit<FilterButtonProps, "singleSelect">) {
    return <FilterButton {...props} singleSelect />;
}
