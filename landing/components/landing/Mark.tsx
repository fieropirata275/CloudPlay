/** Marca de CloudPlay: la nube de plástico índigo. */
export function Mark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9A8BFF" />
          <stop offset="1" stopColor="#5B4BD6" />
        </linearGradient>
      </defs>
      <path
        fill="url(#mark-g)"
        d="M52,140 C30,140 18,124 22,106 C25,92 38,84 52,86 C56,62 76,48 100,50 C124,52 140,70 142,90 C160,88 178,102 176,120 C174,134 162,140 150,140 Z"
      />
    </svg>
  );
}
