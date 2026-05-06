/** Inline SVG illustrations for the marketing portal (no external assets). */

export type TenantIllusLabels = {
  platform: string;
  storeA: string;
  storeB: string;
  storeC: string;
};

export function IllustrationTenant({ labels }: { labels: TenantIllusLabels }) {
  return (
    <svg viewBox="0 0 420 260" width="100%" height="auto" role="img" aria-hidden>
      <defs>
        <linearGradient id="portal-g-cloud" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0.75" />
        </linearGradient>
        <filter id="portal-glow">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x="130" y="16" width="160" height="52" rx="14" fill="url(#portal-g-cloud)" opacity="0.35" filter="url(#portal-glow)" />
      <text x="210" y="48" textAnchor="middle" fill="#f1f5f9" fontSize="13" fontFamily="system-ui, sans-serif" fontWeight="700">
        {labels.platform}
      </text>
      <path d="M 95 78 V 108 M 210 78 V 108 M 325 78 V 108" stroke="#38bdf8" strokeWidth="2" opacity="0.55" strokeLinecap="round" />
      <path d="M 95 108 L 210 140 L 325 108" fill="none" stroke="#64748b" strokeWidth="1.5" opacity="0.45" strokeDasharray="4 3" />
      {[
        { x: 42, label: labels.storeA },
        { x: 157, label: labels.storeB },
        { x: 272, label: labels.storeC },
      ].map((s, i) => (
        <g key={i}>
          <rect x={s.x} y="118" width="106" height="88" rx="10" fill="rgba(15,23,42,0.95)" stroke="#22d3ee" strokeWidth="1.2" opacity="0.95" />
          <rect x={s.x + 12} y="136" width="82" height="8" rx="2" fill="#334155" opacity="0.9" />
          <rect x={s.x + 12} y="152" width="56" height="8" rx="2" fill="#334155" opacity="0.65" />
          <rect x={s.x + 12} y="174" width="82" height="20" rx="4" fill="rgba(34,211,238,0.12)" stroke="rgba(34,211,238,0.35)" strokeWidth="1" />
          <text x={s.x + 53} y="126" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="system-ui">{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

export type FlowIllusLabels = {
  scan: string;
  cart: string;
  pay: string;
  track: string;
};

export function IllustrationOrderFlow({ labels }: { labels: FlowIllusLabels }) {
  const steps = [
    { k: 'scan', tx: labels.scan },
    { k: 'cart', tx: labels.cart },
    { k: 'pay', tx: labels.pay },
    { k: 'track', tx: labels.track },
  ];
  const cx = [52, 148, 244, 340];
  return (
    <svg viewBox="0 0 392 120" width="100%" height="auto" role="img" aria-hidden>
      <defs>
        <marker id="portal-arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#38bdf8" opacity="0.8" />
        </marker>
      </defs>
      {steps.map((s, i) => (
        <g key={s.k}>
          <circle cx={cx[i]} cy="44" r="28" fill="rgba(15,23,42,0.95)" stroke="#22d3ee" strokeWidth="1.5" />
          <text x={cx[i]} y="49" textAnchor="middle" fill="#e2e8f0" fontSize="11" fontFamily="system-ui">{s.tx}</text>
          {i < 3 && (
            <line x1={cx[i] + 28} y1="44" x2={cx[i + 1] - 28} y2="44" stroke="#38bdf8" strokeWidth="2" markerEnd="url(#portal-arr)" opacity="0.75" />
          )}
        </g>
      ))}
      <rect x="24" y="82" width="344" height="28" rx="6" fill="rgba(34,211,238,0.08)" stroke="rgba(34,211,238,0.2)" strokeWidth="1" />
      <rect x="36" y="90" width="120" height="12" rx="3" fill="#334155" opacity="0.85" />
      <rect x="240" y="90" width="112" height="12" rx="3" fill="#334155" opacity="0.55" />
    </svg>
  );
}

export type DashIllusLabels = {
  menu: string;
  orders: string;
  reports: string;
};

export function IllustrationBackoffice({ labels }: { labels: DashIllusLabels }) {
  return (
    <svg viewBox="0 0 380 200" width="100%" height="auto" role="img" aria-hidden>
      <rect x="12" y="12" width="356" height="176" rx="12" fill="rgba(15,23,42,0.9)" stroke="#334155" strokeWidth="1" />
      <rect x="12" y="12" width="88" height="176" rx="12" fill="rgba(30,41,59,0.85)" />
      <text x="56" y="44" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="system-ui">{labels.menu}</text>
      <text x="56" y="72" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="system-ui">{labels.orders}</text>
      <text x="56" y="100" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="system-ui" fontWeight="600">{labels.reports}</text>
      <rect x="118" y="28" width="120" height="36" rx="6" fill="rgba(34,211,238,0.15)" stroke="rgba(34,211,238,0.35)" strokeWidth="1" />
      <rect x="252" y="28" width="100" height="36" rx="6" fill="#1e293b" />
      <rect x="118" y="78" width="234" height="96" rx="8" fill="#0f172a" stroke="#334155" strokeWidth="1" />
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x="132" y={94 + r * 26} width="100" height="10" rx="2" fill="#334155" opacity={0.85 - r * 0.15} />
          <rect x="248" y={94 + r * 26} width="88" height="10" rx="2" fill="#334155" opacity={0.55 - r * 0.1} />
        </g>
      ))}
    </svg>
  );
}
