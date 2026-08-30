import { useTheme } from 'styled-components';

const Dots = ({ color, opacity = 0.5 }) => (
  <g fill={color} opacity={opacity}>
    {Array.from({ length: 6 }).map((_, row) =>
      Array.from({ length: 6 }).map((__, col) => <circle key={`${row}-${col}`} cx={20 + col * 18} cy={20 + row * 18} r="1" />)
    )}
  </g>
);

export const ListIllustration = () => {
  const t = useTheme();
  return (
    <svg viewBox="0 0 400 500" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="500" fill={t.surface2} />
      <g transform="translate(240 40)" opacity="0.55">
        <Dots color={t.rule2} />
      </g>
      <g transform="translate(70 120)">
        <rect x="0" y="0" width="220" height="280" rx="6" fill={t.surface} stroke={t.rule2} strokeWidth="1.5" />
        <rect x="24" y="34" width="90" height="10" rx="2" fill={t.ink} opacity="0.85" />
        <rect x="24" y="54" width="60" height="7" rx="2" fill={t.muted} />

        {[104, 150, 196].map((y, i) => (
          <g key={y}>
            <circle cx="38" cy={y} r="13" fill={i === 0 ? t.goldSoft : t.bgAlt} stroke={i === 0 ? t.gold : t.rule2} strokeWidth="1.4" />
            <path
              d="M-3.5 -5.5c-0.9 0-1.6 0.8-1.4 1.7 0.3 1.6 1.2 3.2 2.5 4.5s2.9 2.2 4.5 2.5c0.9 0.2 1.7-0.5 1.7-1.4v-1.5c0-0.6-0.4-1.1-1-1.2l-1.7-0.4c-0.4-0.1-0.9 0-1.2 0.4l-0.5 0.6c-1.1-0.6-2-1.5-2.6-2.6l0.6-0.5c0.3-0.3 0.5-0.8 0.4-1.2l-0.4-1.7c-0.1-0.5-0.6-0.9-1.2-0.9z"
              transform={`translate(38 ${y})`}
              fill={i === 0 ? t.gold : t.muted}
            />
            <rect x="64" y={y - 5} width={i === 0 ? 118 : 90} height="7" rx="2" fill={t.ink2} opacity={i === 0 ? 0.9 : 0.55} />
            <rect x="64" y={y + 6} width="60" height="5" rx="2" fill={t.muted} opacity="0.6" />
            {i === 0 && (
              <g transform={`translate(198 ${y - 6})`}>
                <circle cx="6" cy="6" r="9" fill={t.gold} />
                <path d="M2.2 6.2l2.5 2.6l5-5.2" stroke={t.bg} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
          </g>
        ))}

        <rect x="24" y="240" width="172" height="1" fill={t.rule} />
        <rect x="24" y="256" width="80" height="6" rx="2" fill={t.muted} opacity="0.5" />
      </g>
    </svg>
  );
};

export const CallIllustration = () => {
  const t = useTheme();
  return (
    <svg viewBox="0 0 400 500" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="500" fill={t.surface2} />
      <g transform="translate(40 40)" opacity="0.55">
        <Dots color={t.rule2} />
      </g>

      <g transform="translate(200 250)">
        {[64, 96, 128].map((r, i) => (
          <circle key={r} cx="0" cy="0" r={r} fill="none" stroke={t.rule2} strokeWidth="1.2" opacity={0.9 - i * 0.22} />
        ))}

        <circle cx="0" cy="0" r="44" fill={t.surface} stroke={t.rule2} strokeWidth="1.5" />
        <path
          d="M-14 -16c-2.6 0-4.6 2.4-4.1 5 .9 4.8 3.4 9.6 7.4 13.6s8.8 6.5 13.6 7.4c2.6.5 5-1.5 5-4.1v-4.6c0-1.7-1.2-3.1-2.8-3.5l-5-1.2c-1.3-.3-2.7.1-3.6 1.1l-1.6 1.7c-3.2-1.9-5.9-4.6-7.8-7.8l1.7-1.6c1-1 1.4-2.4 1.1-3.7l-1.2-4.9c-.4-1.6-1.8-2.7-3.5-2.7z"
          fill={t.gold}
        />

        <g transform="translate(0 -92)">
          <rect x="-30" y="-13" width="60" height="26" rx="13" fill={t.ink} />
          <text x="0" y="4.5" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="10" letterSpacing="1.5" fill={t.bg}>
            AI CALL
          </text>
        </g>

        <path d="M0 -66 L0 -44" stroke={t.rule2} strokeWidth="1.4" strokeDasharray="2 4" />

        <g transform="translate(0 78)">
          <rect x="-38" y="0" width="76" height="30" rx="15" fill={t.surface} stroke={t.rule2} strokeWidth="1.4" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={-24 + i * 12} y={15 - [6, 10, 4, 9, 5][i]} width="4" height={[12, 20, 8, 18, 10][i]} rx="2" fill={t.accentDeep} opacity="0.85" />
          ))}
        </g>
      </g>
    </svg>
  );
};

export const VerifiedIllustration = () => {
  const t = useTheme();
  const rows = [
    { w: 132, dim: false },
    { w: 98, dim: true },
    { w: 112, dim: true },
  ];
  return (
    <svg viewBox="0 0 400 500" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="500" fill={t.surface2} />
      <g transform="translate(30 320)" opacity="0.55">
        <Dots color={t.rule2} />
      </g>

      <g transform="translate(64 110)">
        <rect x="0" y="0" width="272" height="252" rx="6" fill={t.surface} stroke={t.rule2} strokeWidth="1.5" />
        <rect x="0" y="0" width="6" height="252" rx="3" fill={t.gold} />

        <g transform="translate(28 28)">
          <rect x="0" y="0" width="70" height="20" rx="10" fill={t.goodSoft} />
          <text x="35" y="13.5" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9" letterSpacing="1" fill={t.good}>
            VERIFIED
          </text>
        </g>

        {rows.map((row, i) => (
          <g key={i} transform={`translate(28 ${76 + i * 54})`} opacity={row.dim ? 0.5 : 1}>
            <circle cx="9" cy="9" r="9" fill={i === 0 ? t.gold : t.bgAlt} stroke={i === 0 ? t.gold : t.rule2} strokeWidth="1.2" />
            {i === 0 && (
              <path d="M5 9.2l2.6 2.6l5.4-5.6" stroke={t.bg} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            )}
            <rect x="30" y="1" width={row.w} height="8" rx="2" fill={t.ink2} />
            <rect x="30" y="15" width={row.w * 0.6} height="6" rx="2" fill={t.muted} opacity="0.7" />
          </g>
        ))}
      </g>
    </svg>
  );
};

export const AboutIllustration = () => {
  const t = useTheme();
  return (
    <svg viewBox="0 0 500 400" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
      <rect width="500" height="400" fill={t.surface2} />
      <g transform="translate(40 30)" opacity="0.5">
        <Dots color={t.rule2} />
      </g>

      <path
        d="M100 250 C160 150, 200 340, 260 220 S 360 130, 400 190"
        fill="none"
        stroke={t.rule2}
        strokeWidth="1.5"
        strokeDasharray="3 6"
      />

      <g transform="translate(100 250)">
        <circle cx="0" cy="0" r="46" fill={t.surface} stroke={t.rule2} strokeWidth="1.5" />
        <path
          d="M-15 -17c-2.7 0-4.8 2.5-4.3 5.2.9 5 3.6 10 7.8 14.2s9.2 6.9 14.2 7.8c2.7.5 5.2-1.6 5.2-4.3v-4.8c0-1.8-1.2-3.3-3-3.7l-5.2-1.3c-1.4-.3-2.8.1-3.8 1.1l-1.7 1.8c-3.3-2-6.2-4.8-8.2-8.2l1.8-1.7c1-1 1.4-2.4 1.1-3.8l-1.3-5.2c-.4-1.8-1.9-3-3.7-3z"
          fill={t.gold}
        />
      </g>

      <g transform="translate(400 190)">
        <path d="M-38 20 L0 -22 L38 20 Z" fill="none" stroke={t.ink} strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="-26" y="20" width="52" height="40" fill={t.surface} stroke={t.ink} strokeWidth="1.6" />
        <rect x="-8" y="38" width="16" height="22" fill={t.rule2} />
      </g>

      <g transform="translate(250 90)">
        <circle cx="0" cy="0" r="17" fill={t.goodSoft} />
        <path d="M-6 0.5l4 4.2l8.5-9" stroke={t.good} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
};
