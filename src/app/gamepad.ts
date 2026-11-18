/**
 * Game controllers (juniors round, Workstream 1 §4.2): the Gamepad API's "standard" mapping read once a frame and
 * turned into the app's existing controls, never around them:
 * - left stick across: the helm, proportional, through the same rate-limited helm target as dragging the tiller
 *   (SimController.setHelmDrag), so the physics sees the same inputs a keyboard or touch player could make;
 * - right trigger / left trigger: trim / ease the mainsheet, at a rate proportional to how far the trigger is pulled;
 * - right / left shoulder: trim / ease the jib;
 * - A (bottom): tack, B (right): gybe: while held, the helm goes hard over the way that turns the bow into (tack) or
 *   away from (gybe) the wind, exactly as holding the steering key would; let go when round;
 * - X (left): release both sheets; Y (top): centre the helm;
 * - Start: pause; Back/Select: camera; the d-pad: the steering keys.
 *
 * A dead zone and a response curve make small stick movements fine and full movements full. Pure helpers here; the
 * controller polls and applies them (src/app/controller.ts pollGamepad).
 */

export interface PadState {
  axes: readonly number[];
  /** Button values 0…1 (analogue triggers) by standard-mapping index. */
  buttons: readonly number[];
}

export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

/** Stick dead zone (share of travel) and the response curve's exponent (E: common defaults for driving games). */
export const DEAD_ZONE = 0.15;
export const CURVE = 1.6;
/** A button counts as pressed above this (analogue triggers report 0…1). */
export const PRESSED = 0.5;
/** Triggers: below this is rest (some triggers do not return quite to 0). */
export const TRIGGER_REST = 0.05;

/** Dead zone, then rescale the rest to 0…1, then the curve; the sign is kept. */
export function shapeAxis(x: number, dz = DEAD_ZONE, curve = CURVE): number {
  const a = Math.abs(x);
  if (!Number.isFinite(x) || a <= dz) return 0;
  const r = Math.min(1, (a - dz) / (1 - dz));
  return Math.sign(x) * r ** curve;
}

export function shapeTrigger(v: number): number {
  return v <= TRIGGER_REST || !Number.isFinite(v) ? 0 : Math.min(1, (v - TRIGGER_REST) / (1 - TRIGGER_REST));
}

export type PadCommand = 'releaseSheets' | 'centreHelm' | 'pause' | 'camera';

export interface PadFrame {
  /** Helm target (−1 port … 1 starboard, bow sense), or undefined when the stick is at rest. */
  helm?: number;
  /** Sheet rates −1 (trim in) … 1 (ease out), proportional. */
  main: number;
  jib: number;
  /** D-pad sides held (steered as the arrow keys are, in the player's steering mode). */
  dpad: ('left' | 'right')[];
  /** Held steering actions in the bow's sense (the tack and gybe buttons). */
  held: ('helmLeft' | 'helmRight')[];
  /** Commands on the press (not repeated while held). */
  commands: PadCommand[];
}

const down = (s: PadState | undefined, i: number) => (s?.buttons[i] ?? 0) > PRESSED;

/**
 * One frame of a pad. `twa` (rad, + = wind from starboard) chooses the tack and gybe direction; `prev` is the last
 * frame's state, for presses.
 */
export function readPad(s: PadState, prev: PadState | undefined, twa: number): PadFrame {
  const x = shapeAxis(s.axes[0] ?? 0);
  const held: PadFrame['held'] = [];
  const dpad: PadFrame['dpad'] = [];
  if (down(s, PAD.LEFT)) dpad.push('left');
  if (down(s, PAD.RIGHT)) dpad.push('right');
  // Into the wind: with the wind from starboard, the bow turns to starboard.
  const windward = twa >= 0 ? 'helmRight' : 'helmLeft';
  const leeward = windward === 'helmRight' ? 'helmLeft' : 'helmRight';
  if (down(s, PAD.A)) held.push(windward);
  if (down(s, PAD.B)) held.push(leeward);
  const commands: PadCommand[] = [];
  const pressed = (i: number) => down(s, i) && !down(prev, i);
  if (pressed(PAD.X)) commands.push('releaseSheets');
  if (pressed(PAD.Y)) commands.push('centreHelm');
  if (pressed(PAD.START)) commands.push('pause');
  if (pressed(PAD.BACK)) commands.push('camera');
  return {
    helm: x === 0 ? undefined : x,
    main: shapeTrigger(s.buttons[PAD.LT] ?? 0) - shapeTrigger(s.buttons[PAD.RT] ?? 0),
    jib: (down(s, PAD.LB) ? 1 : 0) - (down(s, PAD.RB) ? 1 : 0),
    dpad,
    held,
    commands,
  };
}

/** A pad's state from the browser's Gamepad object (standard mapping only; others are ignored). */
export function padState(g: Gamepad | null | undefined): PadState | undefined {
  if (!g || !g.connected || g.mapping !== 'standard') return undefined;
  return { axes: [...g.axes], buttons: g.buttons.map((b) => b.value || (b.pressed ? 1 : 0)) };
}

/**
 * Vibration (where the browser supports `vibrationActuator`): short pulses for a gust arriving, a tack or gybe (the
 * boom crossing) and contact. Optional (Settings → Controls), off with reduced motion, and never the only way the
 * information is given: each event also has a picture and a sound (src/render/cues.ts lists the pairs).
 */
export type HapticEvent = 'gust' | 'boom' | 'contact';

export const HAPTIC_PULSES: Record<HapticEvent, { duration: number; strong: number; weak: number }> = {
  gust: { duration: 120, strong: 0, weak: 0.35 },
  boom: { duration: 90, strong: 0.5, weak: 0.2 },
  contact: { duration: 220, strong: 0.9, weak: 0.6 },
};

/** Scale a pulse by an event's size (0…1) so a small gust is a small pulse. */
export function hapticPulse(kind: HapticEvent, size = 1): { duration: number; strongMagnitude: number; weakMagnitude: number } {
  const p = HAPTIC_PULSES[kind];
  const k = Math.max(0, Math.min(1, size));
  return { duration: p.duration, strongMagnitude: p.strong * k, weakMagnitude: p.weak * k };
}
