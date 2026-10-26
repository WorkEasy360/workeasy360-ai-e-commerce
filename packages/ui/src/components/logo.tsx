/**
 * The Workeasy360 mark, redrawn as SVG from the logo artwork
 * (packages/ui/assets/logo.jpg): two slanted navy strokes forming the "W",
 * a blue → teal → mint ring, and the mint dot. Gradient IDs take a prefix so
 * several marks on one page never share definitions.
 */
export function BrandMark({ size = 32, title, idPrefix = "we-mark" }: { size?: number; title?: string; idPrefix?: string }) {
  const ring = `${idPrefix}-ring`;
  const strokes = `${idPrefix}-w`;
  return (
    <svg width={size} height={size} viewBox="8 8 84 84" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={ring} gradientUnits="userSpaceOnUse" x1="20" y1="58" x2="86" y2="26">
          <stop offset="0" stopColor="#1257C6" />
          <stop offset=".5" stopColor="#08A8B8" />
          <stop offset="1" stopColor="#05E3A0" />
        </linearGradient>
        <linearGradient id={strokes} gradientUnits="userSpaceOnUse" x1="13" y1="60" x2="77" y2="60">
          <stop offset="0" stopColor="#071C45" />
          <stop offset=".45" stopColor="#0B3A73" />
          <stop offset=".8" stopColor="#0A7FA8" />
          <stop offset="1" stopColor="#08C9B0" />
        </linearGradient>
      </defs>
      <path d="M23.1 40.2 A30.2 30.2 0 0 1 74.4 28.8" fill="none" stroke={`url(#${ring})`} strokeWidth="9" />
      <path d="M82.1 51.6 A30.2 30.2 0 0 1 73.5 70.2" fill="none" stroke={`url(#${ring})`} strokeWidth="9" />
      <circle cx="79.5" cy="40.1" r="7.8" fill="#05E3A0" />
      <path
        d="M13.5 44 Q13 41.2 16 41.2 L24.5 41.2 Q28.5 41.2 31 45 L46 72 Q47 74 45.5 75.8 Q41 81.5 35.5 81.5 Q29.5 81.5 26 75 L14.5 50 Q13.2 47 13.5 44 Z"
        fill={`url(#${strokes})`}
      />
      <path
        d="M35.6 44 Q35.2 41.2 38.3 41.2 L47 41.2 Q51 41.2 53.6 45 L66 68 Q69.5 73.5 75.8 75.8 Q70 81.5 63 81.6 Q55.5 81.6 50.5 73 L36.6 49.5 Q35.4 47 35.6 44 Z"
        fill={`url(#${strokes})`}
      />
    </svg>
  );
}

/** Mark plus "Workeasy360" and a product line, for sign-in and the sidebar. */
export function BrandLockup({ product = "Commerce", size = 34, className }: { product?: string; size?: number; className?: string }) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <BrandMark size={size} />
      <span style={{ lineHeight: 1.1 }}>
        <strong style={{ display: "block" }}>Workeasy360</strong>
        <small>{product}</small>
      </span>
    </span>
  );
}
