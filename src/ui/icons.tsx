import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(props: IconProps, strokeWidth = 2): SVGProps<SVGSVGElement> {
  const { size = 14, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  };
}

export const CubeIcon = (p: IconProps) => (
  <svg {...base(p, 1.8)}>
    <path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" />
    <path d="M3 7.5 12 12l9-4.5" />
    <path d="M12 12v9" />
  </svg>
);
export const LayersIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);
export const FolderIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p, 2.5)}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
export const ChevronUpIcon = (p: IconProps) => (
  <svg {...base(p, 2.5)}>
    <polyline points="18 15 12 9 6 15" />
  </svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p, 2.5)}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const ReloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <polyline points="21 4 21 10 15 10" />
  </svg>
);
export const CollapseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9h16M4 15h16" />
  </svg>
);
export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const CheckIcon = (p: IconProps) => (
  <svg {...base(p, 2.4)}>
    <polyline points="4 12 10 18 20 6" />
  </svg>
);
export const EyeIcon = (p: IconProps) => (
  <svg {...base(p, 1.8)}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const EyeOffIcon = (p: IconProps) => (
  <svg {...base(p, 1.8)}>
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a20.4 20.4 0 0 1-3.2 4.19M1 1l22 22" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
  </svg>
);
export const MeshIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <path d="M12 4 21 19H3z" />
  </svg>
);
export const MaterialIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
  </svg>
);
export const TextureIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 12h18M12 3v18" />
  </svg>
);
export const PlayIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <polygon points="7 4 20 12 7 20" />
  </svg>
);
export const PauseIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4.4" height="14" rx="1.2" />
    <rect x="13.6" y="5" width="4.4" height="14" rx="1.2" />
  </svg>
);
export const StopIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);
export const FirstIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <polygon points="19 5 9 12 19 19" />
    <rect x="5" y="5" width="2.6" height="14" rx="1" />
  </svg>
);
export const LastIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <polygon points="5 5 15 12 5 19" />
    <rect x="16.4" y="5" width="2.6" height="14" rx="1" />
  </svg>
);
export const PrevIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <polygon points="16 5 7 12 16 19" />
  </svg>
);
export const NextIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <polygon points="8 5 17 12 8 19" />
  </svg>
);
export const LoopIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);
export const CameraIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
  </svg>
);
export const BoneIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <path d="M17 3a3 3 0 0 1 3 3 3 3 0 0 1-1.7 2.7L8.7 18.3A3 3 0 1 1 5.7 15.3L15.3 5.7A3 3 0 0 1 17 3z" />
  </svg>
);
export const LightIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
  </svg>
);
export const LightmapIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);
export const CollisionIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <path d="M12 3l8 3v6c0 4.5-3.5 8.3-8 9-4.5-.7-8-4.5-8-9V6z" />
  </svg>
);
export const NavmeshIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M8 18.5C13 17 11 8 16 6" />
  </svg>
);
export const TreeIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <rect x="3" y="3" width="6" height="5" rx="1" />
    <rect x="15" y="10" width="6" height="5" rx="1" />
    <rect x="15" y="17" width="6" height="5" rx="1" />
    <path d="M9 5.5h3v14h3M12 12.5h3" />
  </svg>
);
export const InstancesIcon = (p: IconProps) => (
  <svg {...base(p, 1.7)}>
    <rect x="3" y="8" width="13" height="13" rx="1.5" />
    <path d="M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3" />
  </svg>
);
export const DotsIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </svg>
);
export const TimelineIcon = (p: IconProps) => (
  <svg {...base(p, 1.8)}>
    <path d="M3 6h18M3 12h10M3 18h14" />
    <circle cx="17" cy="12" r="2" fill="currentColor" stroke="none" />
  </svg>
);
export const OnionIcon = (p: IconProps) => (
  <svg {...base(p, 1.8)}>
    <circle cx="9" cy="12" r="6" />
    <circle cx="15" cy="12" r="6" opacity="0.6" />
  </svg>
);
export const SnapIcon = (p: IconProps) => (
  <svg {...base(p, 1.8)}>
    <path d="M4 4v16M20 4v16M4 12h16" />
    <path d="M12 8v8" />
  </svg>
);
export const HistoryIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <polyline points="3 4 3 10 9 10" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const WarningIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 2 20h20z" />
    <path d="M12 9v5M12 17h.01" />
  </svg>
);
