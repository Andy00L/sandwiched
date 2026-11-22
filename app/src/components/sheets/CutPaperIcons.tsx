const INK = "#3b2a22";
const CORE = "#f2e6cb";

export function ChipStackIcon({ chips, size }: { chips: number; size: number }) {
  const layers = Math.min(6, Math.max(2, Math.round(chips / 160)));
  return (
    <svg width={size} height={size} viewBox="-12 -14 24 24" aria-hidden="true">
      {Array.from({ length: layers }, (_unused, layer) => {
        const offsetY = 6 - layer * 2.6;
        return (
          <g key={layer}>
            <ellipse cx="0" cy={offsetY + 1.4} rx="9" ry="3.4" fill="#96602f" stroke={INK} strokeWidth="0.5" />
            <ellipse cx="0" cy={offsetY} rx="9" ry="3.4" fill={layer % 2 === 0 ? "#d5452e" : CORE} stroke={INK} strokeWidth="0.5" />
            <path d={`M-7.6 ${offsetY - 1.2} q7.6 -2.8 15.2 0`} fill="none" stroke={CORE} strokeOpacity="0.7" strokeWidth="0.45" />
          </g>
        );
      })}
    </svg>
  );
}

export function InkedWhale({ size }: { size: number }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="-30 -26 60 48" aria-hidden="true">
      <path d="M-22 4 q0 -24 22 -24 q22 0 22 24 v6 q0 8 -9 8 h-26 q-9 0 -9 -8 z" fill="#5e7f97" stroke={INK} strokeWidth="1.2" />
      <path d="M-20 6 q20 8 40 0 v4 q0 7 -8 7 h-24 q-8 0 -8 -7 z" fill="#c7d5da" stroke={INK} strokeWidth="0.8" />
      <circle cx="-8" cy="-4" r="4" fill={CORE} stroke={INK} strokeWidth="0.8" />
      <circle cx="8" cy="-4" r="4" fill={CORE} stroke={INK} strokeWidth="0.8" />
      <circle cx="-7" cy="-3.4" r="1.7" fill={INK} />
      <circle cx="9" cy="-3.4" r="1.7" fill={INK} />
      <path d="M-13 -11 l9 2.5 M13 -11 l-9 2.5" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M-4 18 l4 5 l4 -5 z" fill="#d5452e" stroke={INK} strokeWidth="0.7" />
    </svg>
  );
}

export function InkedPigeon({ size }: { size: number }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="-30 -26 60 48" aria-hidden="true">
      <path d="M-20 10 q-4 -16 12 -20 q18 -4 26 8 q4 8 -4 14 h-28 q-6 0 -6 -2 z" fill="#8e96a3" stroke={INK} strokeWidth="1.2" />
      <path d="M-6 -6 q10 -2 18 6 q-6 6 -16 4 z" fill="#5b6472" stroke={INK} strokeWidth="0.8" />
      <circle cx="16" cy="-14" r="7" fill="#8e96a3" stroke={INK} strokeWidth="1.1" />
      <path d="M9.5 -11 q6 4 13 0" fill="none" stroke="#3c998c" strokeWidth="2" />
      <circle cx="18" cy="-16" r="1.6" fill={INK} />
      <path d="M22.5 -14.5 l6 1.6 l-6 1.6 z" fill="#e0a62c" stroke={INK} strokeWidth="0.6" />
      <path d="M-4 16 v6 M4 16 v6" stroke="#d5452e" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function PaperPlate({ size, fill, kind }: { size: number; fill: number; kind: "sandwich" | "crumbs" }) {
  const share = Math.min(1, Math.max(0, fill));
  return (
    <svg width={size} height={size * 0.62} viewBox="-32 -20 64 40" aria-hidden="true">
      <ellipse cx="0" cy="3" rx="30" ry="15" fill="#d3bf98" stroke={INK} strokeWidth="0.8" />
      <ellipse cx="0" cy="1" rx="30" ry="15" fill={CORE} stroke={INK} strokeWidth="0.9" />
      <ellipse cx="0" cy="1" rx="21" ry="10" fill="none" stroke={INK} strokeOpacity="0.35" strokeWidth="0.6" />
      {kind === "sandwich" && share > 0 ? (
        <g>
          <path d={`M-16 -2 h${32 * share} l-2 7 h${-28 * share} z`} fill="#c58a4b" stroke={INK} strokeWidth="0.7" />
          <path d={`M-15 -4 h${30 * share}`} stroke="#7b9566" strokeWidth="2.2" strokeLinecap="round" />
          <path d={`M-15 -6.5 h${30 * share} q0 -4 -4 -4 h${-26 * share} q-2 0 -2 4 z`} fill="#e0a62c" stroke={INK} strokeWidth="0.7" />
        </g>
      ) : null}
      {kind === "crumbs"
        ? Array.from({ length: Math.round(share * 22) }, (_unused, crumb) => {
            const angle = crumb * 2.4;
            const radius = 2 + (crumb % 7) * 1.7 * Math.sqrt(share);
            return <circle key={crumb} cx={Math.cos(angle) * radius * 1.5} cy={Math.sin(angle) * radius * 0.6} r={1.1} fill="#c58a4b" stroke={INK} strokeWidth="0.35" />;
          })
        : null}
    </svg>
  );
}
