import React from 'react'

// All icons are 1em by default, inherit currentColor
interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number | string
}

const defaultProps = (props: IconProps): React.SVGAttributes<SVGSVGElement> => {
  const { size = '1em', ...rest } = props
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  }
}

// --- Navigation ---
export const IconArrowLeft: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)

export const IconArrowRight: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
)

// --- Actions ---
export const IconPlus: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const IconClose: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export const IconCheck: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export const IconDelete: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

export const IconSave: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
)

export const IconExport: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

export const IconClear: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </svg>
)

export const IconReload: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
)

export const IconUndo: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.12-9.36L1 10" />
  </svg>
)

export const IconSend: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)

// --- Media Controls ---
export const IconPlay: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
  </svg>
)

export const IconPause: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
    <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" />
  </svg>
)

export const IconStop: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />
  </svg>
)

// --- Objects ---
export const IconSettings: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export const IconGlobe: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)

export const IconRobot: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <rect x="3" y="8" width="18" height="12" rx="2" />
    <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none" />
    <line x1="12" y1="4" x2="12" y2="8" />
    <circle cx="12" cy="3" r="1" fill="currentColor" stroke="none" />
  </svg>
)

export const IconFileText: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
)

export const IconMessage: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export const IconExperiment: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M9 3h6v4l4 8H5l4-8V3z" />
    <line x1="9" y1="3" x2="15" y2="3" />
    <path d="M5 15h14v2a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-2z" />
  </svg>
)

export const IconSwap: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
)

export const IconCloudDownload: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polyline points="8 17 12 21 16 17" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
  </svg>
)

export const IconCode: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
)

export const IconDatabase: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
)

export const IconShield: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

export const IconApp: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </svg>
)

export const IconBolt: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" stroke="none" />
  </svg>
)

export const IconApi: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M10 20l4-16" />
    <path d="M6 8l-4 4 4 4" />
    <path d="M18 8l4 4-4 4" />
  </svg>
)

export const IconEdit: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)

export const IconSync: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
)

export const IconCheckCircle: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
)

export const IconCloseCircle: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
)

export const IconWifi: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
)

export const IconLoading: React.FC<IconProps> = (props) => {
  const { size = '1em', style, ...rest } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      overflow="hidden"
      style={{ display: 'block', overflow: 'hidden', ...style }}
      {...rest}
    >
      <g>
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.6s"
          repeatCount="indefinite"
        />
      </g>
    </svg>
  )
}

// --- Window Controls ---
export const IconMinimize: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const IconMaximize: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <rect x="5" y="5" width="14" height="14" rx="1" />
  </svg>
)

export const IconSun: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
)

export const IconMoon: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

export const IconGitHub: React.FC<IconProps> = (props) => (
  <svg {...defaultProps(props)} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
)

// IconClose is already defined above and works for window close too
