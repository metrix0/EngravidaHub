import { BRAZIL_STATES } from "@/lib/units/brazilMap";

export default function UnitMap({
  state,
  name,
}: {
  state: string;
  name: string;
}) {
  return (
    <svg
      viewBox="0 0 420 410"
      role="img"
      aria-label={`Mapa do Brasil: ${name}, ${state}`}
      className="mx-auto h-40 w-full"
    >
      {BRAZIL_STATES.map((item) => (
        <path
          key={item.state}
          d={item.path}
          fill={item.state === state ? "var(--color-brand)" : "#f1f5f9"}
          stroke={item.state === state ? "var(--color-brand)" : "#cbd5e1"}
          strokeWidth={item.state === state ? 2.5 : 0.8}
          strokeLinejoin="round"
        >
          <title>{item.name}</title>
        </path>
      ))}
    </svg>
  );
}
