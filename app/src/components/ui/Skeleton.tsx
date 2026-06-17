// app/src/components/ui/Skeleton.tsx

type SkeletonProps = {
    className?: string;
};

export default function Skeleton({ className = "" }: SkeletonProps) {
    return <div className={`skeleton-shimmer rounded-xl ${className}`} />;
}

export const __uiDemo = {
    element: <Skeleton className="h-10 w-[220px]" />,
    code: '<Skeleton className="h-10 w-[220px]" />',
};