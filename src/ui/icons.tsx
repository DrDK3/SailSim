import type { ActivityKind } from './activity';

/** Line icons (24 × 24, drawn in currentColor), decorative: every use has a text label beside it. */
const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg className="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

/** A compass: learning to read the wind and steer. */
export const IconLearn = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M15.5 8.5 13 13l-4.5 2.5L11 11z" />
  </Svg>
);

/** A sail on its mast over a hull: free sailing. */
export const IconSail = () => (
  <Svg>
    <path d="M12 3v14" />
    <path d="M12 4.5 18 15h-6" />
    <path d="M11 6.5 6.5 15H11" />
    <path d="M4 18h16l-2 2.5H6z" />
  </Svg>
);

/** A flag on a staff: racing. */
export const IconRace = () => (
  <Svg>
    <path d="M6 21V3.5" />
    <path d="M6 4h11l-2.5 3.5L17 11H6" />
  </Svg>
);

/** Stacked cards: the scenario library. */
export const IconScenarios = () => (
  <Svg>
    <rect x="4" y="7" width="13" height="13" rx="2" />
    <path d="M8 4h10a2 2 0 0 1 2 2v10" />
    <path d="M7.5 12h6M7.5 15.5h4" />
  </Svg>
);

/** A play triangle in a circle: a replay. */
export const IconReplay = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M10 8.5v7l5.5-3.5z" />
  </Svg>
);

export function ActivityIcon({ kind }: { kind: ActivityKind }) {
  switch (kind) {
    case 'race':
    case 'course':
      return <IconRace />;
    case 'tutorial':
      return <IconLearn />;
    case 'replay':
      return <IconReplay />;
    default:
      return <IconSail />;
  }
}
