import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Activity } from './activity';
import { IconLearn, IconRace, IconSail, IconScenarios } from './icons';
import { useModal } from './useModal';
import type { SteeringMode } from '../app/steering';
import type { InterfaceLevel } from '../app/level';
import { AboutContent } from './About';

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
 * The experience hub. On the first visit it is one question and a large "Sail now" (owner, 18 Nov 2026: "a lighter
 * first minute"; for a newcomer Sail now is lesson 1): the four ways in (learn, sail freely, race, ready-made
 * scenarios) wait behind "More ways to sail", and what the simulator is and how far to trust it is on the About
 * page. Afterwards the activity button in the toolbar brings the hub back with the four ways in shown. The water
 * stays live behind it.
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
  // The first visit starts with the four ways in put away; the About page takes the hub's place while it is read.
  const [more, setMore] = useState(!first);
  const [about, setAbout] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  return (
    <div ref={ref} className="overlay hub-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onClick={onClose}>
      <section className={`panel hub${about || (first && !more) ? ' hub-light' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="hub-head">
          <div>
            <h2 id="welcome-title">Squib sailing simulator</h2>
            {!first && !about && <p className="hub-sub">Learn to sail, explore the water, or race against AI Squibs.</p>}
          </div>
          <button className="hub-close" onClick={onClose} aria-label={first ? 'Close and look around' : 'Close'}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {about ? (
          <>
            <h3 className="about-title">About this simulator</h3>
            <AboutContent />
            <button onClick={() => setAbout(false)} data-testid="about-back">
              Back
            </button>
          </>
        ) : (
          <>
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
                <p className="fine" data-testid="steering-note">
                  {steering === 'tiller' ? 'A / ← pushes the tiller to port, so the bow turns to starboard, as at a Squib’s helm.' : 'A / ← turns the bow to port, D / → to starboard.'}{' '}
                  Settings changes it.
                </p>
              </fieldset>
            )}
            {first && (
              <button ref={sailNow} className="primary sail-now" onClick={onSailNow} data-testid="sail-now">
                <span className="sail-now-title">Sail now</span>
                <span className="sail-now-text">
                  {level === 'learn' ? 'Lesson 1, steering: about 3 minutes' : level === 'expert' ? 'Free sailing in Start Bay, every instrument shown' : 'Free sailing in Start Bay, with the race coach'}
                </span>
              </button>
            )}
            {!first && (
              <p className="hub-now" data-testid="hub-now">
                Now: <strong>{activity.label}</strong>
                {activity.detail && <span className="fine-inline"> · {activity.detail}</span>}
                <button className="link" onClick={onClose}>Carry on</button>
              </p>
            )}
            {more && (
              <div className="hub-grid" id="hub-ways">
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
                  text="Ready-made sessions: light air, fresh and shifty, fog, rain, wind against tide, an evening sail, practice races. Your own saved scenarios and replays too."
                  onClick={onScenarios}
                />
              </div>
            )}
            <div className="hub-links">
              {first && (
                <button className="link" onClick={() => setMore(!more)} aria-expanded={more} aria-controls="hub-ways" data-testid="hub-more">
                  {more ? 'Fewer ways to sail' : 'More ways to sail'}
                </button>
              )}
              <button className="link" onClick={() => setAbout(true)} data-testid="hub-about">
                About this simulator
              </button>
            </div>
            {!first && (
              <p className="fine hub-foot">
                Keys: A / D steer · W / S main · Q / E jib · P pause · C camera · H help. Come back here with the activity button at the start of
                the toolbar. Not for navigation.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
