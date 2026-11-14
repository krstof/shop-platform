// Logo der Plattform „Slopify“ (Scherzname, 14.11.2026): eigenes Zeichen, ein violetter Klecks, der
// nach unten tropft. Bewusst kein Bezug zum Aussehen anderer Marken.
const VIOLET = "#7c3aed";

export function SlopifyMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path
        fill={VIOLET}
        d="M4 10a6 6 0 0 1 6-6h12a6 6 0 0 1 6 6v3.5c0 1.4-1 2.2-2.2 2.2-1.3 0-2.3.9-2.3 2.2v6.6a2.75 2.75 0 0 1-5.5 0v-4.3c0-1.3-.9-2.2-2.1-2.2s-2.1.9-2.1 2.2v.6a2.4 2.4 0 0 1-4.8 0V10z"
      />
      <circle cx="12.9" cy="27" r="1.9" fill={VIOLET} />
    </svg>
  );
}

/** Zeichen plus Schriftzug „slopify“. */
export function SlopifyLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const mark = size === "lg" ? "size-9" : size === "sm" ? "size-5" : "size-6";
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  return (
    <span className="inline-flex items-center gap-1.5">
      <SlopifyMark className={mark} />
      <span className={`${text} font-extrabold tracking-tight text-stone-900`}>slopify</span>
    </span>
  );
}
