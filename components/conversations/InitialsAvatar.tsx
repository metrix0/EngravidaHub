// components/conversations/InitialsAvatar.tsx

export function InitialsAvatar({ name }: { name: string }) {
    const initials = getInitials(name);
    const colorClass = getInitialsColor(initials);

    return (
        <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${colorClass}`}
        >
            {initials}
        </span>
    );
}

function getInitials(name: string) {
    return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}

function getInitialsColor(initials: string) {
    const colors = [
        "bg-violet-100 text-violet-700",
        "bg-blue-100 text-blue-700",
        "bg-cyan-100 text-cyan-700",
        "bg-indigo-100 text-indigo-700",
        "bg-sky-100 text-sky-700",
        "bg-fuchsia-100 text-fuchsia-700",
        "bg-teal-100 text-teal-700",
        "bg-pink-100 text-pink-700"
    ];

    let hash = 0;

    for (let i = 0; i < initials.length; i++) {
        hash = initials.charCodeAt(i) + ((hash << 5) - hash);
    }

    return colors[Math.abs(hash) % colors.length];
}

export const __uiDemo = {
    element: (
        <div className="flex items-center gap-3">
            <InitialsAvatar name="Maria Silva" />
            <InitialsAvatar name="João Santos" />
            <InitialsAvatar name="Ana Paula" />
            <InitialsAvatar name="Pedro Lima" />
        </div>
    ),
    code: `<div className="flex items-center gap-3">
  <InitialsAvatar name="Maria Silva" />
  <InitialsAvatar name="João Santos" />
  <InitialsAvatar name="Ana Paula" />
  <InitialsAvatar name="Pedro Lima" />
</div>`,
};
