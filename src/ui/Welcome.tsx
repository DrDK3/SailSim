import { useEffect, useRef, type ReactNode } from 'react';
import type { Activity } from './activity';
import { IconLearn, IconRace, IconSail, IconScenarios } from './icons';
import { useModal } from './useModal';
import type { SteeringMode } from '../app/steering';
import type { InterfaceLevel } from '../app/level';

const KEY = 'squib.welcomed.v1';

/** Whether to greet a first-time visitor (kept in this browser; storage errors count as "seen"). */
export function shouldWelcome(): boolean {
  try {
    return !localStorage.getItem(KEY) && !new URLSearchParams(location.search).has('nowelcome');
  } catch {
    return false;
  }
}

export function markWelcomed(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // storage unavailable: the welcome may show again next time
  }
}

function Door({ id, title, text, icon, onClick, focus }: { id: string; title: string; text: string; icon: ReactNode; onClick: () => void; focus?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <button ref={ref} className={`hub-door door-${id}`} onClick={onClick} aria-labelledby={`door-${id}-t`} aria-describedby={`door-${id}-d`} data-testid={`door-${id}`}>
      <span className="door-icon">{icon}</span>
      <span className="door-title" id={`door-${id}-t`}>{title}</span>
      <span className="door-text" id={`door-${id}-d`}>{text}</span>
    </button>
  );
}

/** What "Free sailing" does from the current activity (it never starts anything the user did not ask for). */
function freeText(a: Activity): string {
  switch (a.kind) {
    case 'race':
    case 'course':
      return 'Leave the course and its fleet and sail freely from the start, in the same place and conditions.';
    case 'tutorial':
      return 'End the lesson and sail on from where you are.';
    case 'replay':
      return 'Stop the replay and sail on from this moment.';
    default:
      return 'Sail now and explore the River Dart and Start Bay. Change the boat, the place, the wind and the tide in Scenario.';
  }
}

/** The first-visit question's answers: each sets the interface level (U5) and the steering keys (D4). */
const ANSWERS: { id: string; label: string; level: InterfaceLevel; steering: SteeringMode }[] = [
  { id: 'steer-bow', label: 'Not yet', level: 'learn', steering: 'bow' },
  { id: 'steer-tiller', label: 'Yes, I sail', level: 'club', steering: 'tiller' },
  { id: 'level-expert', label: 'I race', level: 'expert', steering: 'tiller' },
];

/**
 * The experience hub: on the first visit, one question and "Sail now" as the first, largest action (review UI
 * benchmark G1–G2: into the water within seconds; for a newcomer that is lesson 1); then the four ways in (learn,
 * sail freely, race, ready-made scenarios), each opening the simulator's existing, working feature. Afterwards
 * the activity button in the toolbar brings it back. The water stays live behind it.
 */
export function ExperienceHub({
  first,
  activity,
  onClose,
  onLearn,
  onFree,
  onRace,
  onScenarios,
  onSailNow,
  steering,
  level,
  onAnswer,
  lessonsDone,
}: {
  first: boolean;
  steering: SteeringMode;
  level: InterfaceLevel;
  onAnswer: (level: InterfaceLevel, steering: SteeringMode) => void;
  activity: Activity;
  onClose: () => void;
  onLearn: () => void;
  onFree: () => void;
  onRace: () => void;
  onScenarios: () => void;
  onSailNow: () => void;
  lessonsDone: number;
}) {
  const sailNow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (first) sailNow.current?.focus();
  }, [first]);
  const answer = ANSWERS.find((a) => a.level === level && a.steering === steering);
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  return (
    <div ref={ref} className="overlay hub-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onClick={onClose}>
      <section className="panel hub" onClick={(e) => e.stopPropagation()}>
        <div className="hub-head">
          <div>
            <h2 id="welcome-title">Squib sailing simulator</h2>
            <p className="hub-sub">Learn to sail, explore the water, or race against AI Squibs.</p>
          </div>
          <button className="hub-close" onClick={onClose} aria-label={first ? 'Close and look around' : 'Close'}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {first ? (
          <p className="hub-intro">
            Sail a National Squib, the 5.8 m keelboat raced at the Royal Dart Yacht Club, on the River Dart and in Start Bay. The boat moves by a
            physics model whose coefficients are still estimates, and the wind can come from the Met Office forecast.
          </p>
        ) : null}
        {first && (
          // One question on the first visit sets the steering keys (decision D4) and the interface level (U5);
          // Settings changes either later.
          <fieldset className="hub-ask" data-testid="steering-ask">
            <legend>Have you sailed before?</legend>
            <div className="row left wrap">
              {ANSWERS.map((a) => (
                <button key={a.id} aria-pressed={answer?.id === a.id} onClick={() => onAnswer(a.level, a.steering)} data-testid={a.id}>
                  {a.label}
                </button>
              ))}
            </div>
            <p className="fine">
              {steering === 'tiller'
                ? 'A / ← push the tiller to port, so the bow turns to starboard, as when you helm a Squib.'
                : 'A / ← turn the bow to port and D / → to starboard. The tiller picture in the dock shows what a real tiller would do.'}{' '}
              {level === 'learn' ? 'Lessons and the teaching overlay come first.' : level === 'expert' ? 'Every instrument is shown; the coach is off.' : 'The main instruments and the race coach.'}{' '}
              You can change both in More → Settings.
            </p>
          </fieldset>
        )}
        {first && (
          <button ref={sailNow} className="primary sail-now" onClick={onSailNow} data-testid="sail-now">
            <span className="sail-now-title">Sail now</span>
            <span className="sail-now-text">{level === 'learn' ? 'Lesson 1, steering: in the water at once, about 3 minutes' : 'Free sailing in Start Bay, the wind as set'}</span>
          </button>
        )}
        {!first && (
          <p className="hub-now" data-testid="hub-now">
            Now: <strong>{activity.label}</strong>
            {activity.detail && <span className="fine-inline"> · {activity.detail}</span>}
            <button className="link" onClick={onClose}>Carry on</button>
          </p>
        )}
        <div className="hub-grid">
          <Door
            id="learn"
            title="Learn to sail"
            icon={<IconLearn />}
            text={`Six short lessons, each checked as you sail: steering, the wind, trim, tacking and gybing, the start, the stream; then seamanship: a mooring, coming alongside, man overboard. ${lessonsDone ? `${lessonsDone} of 6 basics done.` : 'About 3–5 minutes each.'}`}
            onClick={onLearn}
          />
          <Door id="free" title="Free sailing" icon={<IconSail />} focus={!first} text={freeText(activity)} onClick={onFree} />
          <Door
            id="race"
            title="Race against AI"
            icon={<IconRace />}
            text="Today’s challenge, or up to 20 AI Squibs in Start Bay (from a five-minute short course up), on the river, on an RDYC course or your own: the fleet, the start and the conditions."
            onClick={onRace}
          />
          <Door
            id="scenarios"
            title="Scenarios"
            icon={<IconScenarios />}
            text="Ready-made sessions: light air, fresh and shifty, fog, rain, wind against tide, an evening sail, practice races, a Met Office replay. Your own saved scenarios and replays too."
            onClick={onScenarios}
          />
        </div>
        <p className="fine hub-foot">
          Keys: A / D steer · W / S main · Q / E jib · P pause · C camera · H help. Come back here with the activity button at the start of the
          toolbar. Not for navigation.
        </p>
      </section>
    </div>
  );
}
