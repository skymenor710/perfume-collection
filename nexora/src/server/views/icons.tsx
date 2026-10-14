// Icônes SVG dessinées pour le site (trait 1,6 px, extrémités arrondies). Toujours décoratives (aria-hidden).
const base = {
  xmlns: 'http://www.w3.org/2000/svg',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.6',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false',
} as const;

export const ArrowUpRight = ({ size = 18 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 24 24" class="icon">
    <path d="M7 17 17 7" />
    <path d="M8.5 7H17v8.5" />
  </svg>
);

export const ChevronLeft = () => (
  <svg {...base} width="22" height="22" viewBox="0 0 24 24" class="icon">
    <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
  </svg>
);

export const ChevronRight = () => (
  <svg {...base} width="22" height="22" viewBox="0 0 24 24" class="icon">
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </svg>
);

export const MenuIcon = () => (
  <svg {...base} width="28" height="28" viewBox="0 0 28 28" class="icon icon--menu">
    <path class="l1" d="M4 8h20" />
    <path class="l2" d="M4 14h20" />
    <path class="l3" d="M4 20h20" />
  </svg>
);

export const MouseIcon = () => (
  <svg {...base} width="22" height="36" viewBox="0 0 22 36" class="icon icon--mouse" stroke-width="1.4">
    <rect x="1.5" y="1.5" width="19" height="31" rx="9.5" />
    <path class="wheel" d="M11 8v5" />
  </svg>
);

export const ExternalIcon = () => (
  <svg {...base} width="15" height="15" viewBox="0 0 24 24" class="icon">
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base} width="20" height="20" viewBox="0 0 24 24" class="icon">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const AlertIcon = () => (
  <svg {...base} width="20" height="20" viewBox="0 0 24 24" class="icon">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16.5h.01" />
  </svg>
);
