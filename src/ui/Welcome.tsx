import { useEffect, useRef, type ReactNode } from 'react';
import type { Activity } from './activity';
import { IconLearn, IconRace, IconSail, IconScenarios } from './icons';

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

/**
 * The experience hub: the four ways in (learn, sail freely, race, ready-made scenarios), each opening the
 * simulator's existing, working feature. Shown by itself on the first visit only; afterwards the activity button
 * in the toolbar brings it back. The water stays live behind it.
 */
export function ExperienceHub({
  first,
  activity,
  onClose,
  onLearn,
  onFree,
  onRace,
  onScenarios,
}: {
  first: boolean;
  activity: Activity;
  onClose: () => void;
  onLearn: () => void;
  onFree: () => void;
  onRace: () => void;
  onScenarios: () => void;
}) {
  return (
    <div className="overlay hub-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onKeyDown={(e) => e.key === 'Escape' && onClose()} onClick={onClose}>
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
        ) : (
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
            focus={first}
            text="An interactive lesson: steer, sail across the wind, trim, tack, gybe and stop, each step checked as you sail. About five minutes."
            onClick={onLearn}
          />
          <Door id="free" title="Free sailing" icon={<IconSail />} focus={!first} text={freeText(activity)} onClick={onFree} />
          <Door
            id="race"
            title="Race against AI"
            icon={<IconRace />}
            text="Up to 20 AI Squibs in Start Bay or on the river: choose the fleet, its level, the course, the start sequence and the conditions."
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
