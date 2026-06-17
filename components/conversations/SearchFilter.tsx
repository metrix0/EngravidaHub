// components/conversations/SearchFilter.tsx
import { Search } from "lucide-react";
import {useState} from "react";

export function SearchFilter({
                                             value,
                                             onChange,
                                         }: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex h-11 w-[310px] cursor-text items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-500 shadow-sm transition-colors hover:bg-slate-50 ">
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="Buscar por cliente ou telefone..."
                className="w-full bg-transparent outline-none placeholder:text-slate-400 focus:outline-none focus-visible:outline-none"
            />

            <Search size={16} className="shrink-0 text-slate-500" />
        </div>
    );
}

function ConversationSearchFilterDemo() {
    const [value, setValue] = useState("");

    return (
        <SearchFilter
            value={value}
            onChange={setValue}
        />
    );
}

export const __uiDemo = {
    element: <ConversationSearchFilterDemo />,
    code: `<ConversationSearchFilter
  value={search}
  onChange={setSearch}
/>`,
};
