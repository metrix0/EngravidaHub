"use client";

import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";

export default function AgendaIntelligenceSkeleton() {
    return <div role="status" aria-label="Carregando inteligência de agenda" className="space-y-5">
        <span className="sr-only">Carregando inteligência de agenda...</span>
        <div aria-hidden="true" className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => <Card key={index}><Skeleton className="mb-4 h-5 w-32" /><Skeleton className="h-9 w-24" /><Skeleton className="mt-3 h-3 w-40 max-w-full" /></Card>)}
            </div>
            <Card><Skeleton className="mb-6 h-6 w-56 max-w-full" /><Skeleton className="h-72 w-full" /></Card>
            <Card>
                <Skeleton className="mb-2 h-6 w-64 max-w-full" /><Skeleton className="mb-5 h-4 w-80 max-w-full" />
                <div className="grid gap-4 lg:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-80 w-full" />)}</div>
            </Card>
            {["preferences", "doctors"].map(key => <Card key={key}><Skeleton className="mb-6 h-6 w-64 max-w-full" /><Skeleton className="mb-4 h-10 w-full" />{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="mb-3 h-12 w-full" />)}</Card>)}
            <Card><Skeleton className="mb-6 h-6 w-72 max-w-full" /><Skeleton className="h-40 w-full" /></Card>
        </div>
    </div>;
}
