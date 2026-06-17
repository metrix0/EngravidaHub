// app/src/components/ui/Pagination.tsx

"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationProps = {
    totalPages: number;
    currentPage: number;
    onPageChange: (page: number) => void;
};

type PaginationPage = number | "...";

export default function Pagination({
                                       totalPages,
                                       currentPage,
                                       onPageChange,
                                   }: PaginationProps) {
    const pages = getPaginationPages(totalPages, currentPage);

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => onPageChange(currentPage - 1)}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
                <ChevronLeft size={18} />
            </button>

            {pages.map((page, index) =>
                page === "..." ? (
                    <div
                        key={`ellipsis-${index}`}
                        className="flex h-10 w-10 items-center justify-center text-slate-500"
                    >
                        ...
                    </div>
                ) : (
                    <button
                        key={page}
                        type="button"
                        onClick={() => onPageChange(page)}
                        className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-sm font-semibold transition-colors ${
                            page === currentPage
                                ? "bg-purple-soft text-purple"
                                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                    >
                        {page}
                    </button>
                )
            )}

            <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => onPageChange(currentPage + 1)}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
                <ChevronRight size={18} />
            </button>
        </div>
    );
}

function getPaginationPages(
    totalPages: number,
    currentPage: number
): PaginationPage[] {
    if (totalPages <= 1) return [1];

    if (totalPages <= 5) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    if (currentPage <= 3) {
        return [1, 2, 3, "...", totalPages];
    }

    if (currentPage >= totalPages - 2) {
        return [1, "...", totalPages - 2, totalPages - 1, totalPages];
    }

    return [1, "...", currentPage, "...", totalPages];
}