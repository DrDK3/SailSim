/**
 * How the steering keys and buttons work (review UX-8, decision D4).
 *  - 'bow': A / ← turn the bow to port, D / → to starboard, as in a car or a game (the first default).
 *  - 'tiller': A / ← push the tiller to port, so the bow turns to starboard, as on the boat: the helm pushes the
 *    tiller away from the way the bow is to go.
 * The tiller is drawn in the dock in both modes. The choice is asked once, on the first visit ("Have you sailed
 * before?": sailors get the tiller), and can be changed in Settings → Controls. It changes only which key moves
 * which way; the physics and recordings (which keep the helm, not the keys) are the same either way.
 */
export type SteeringMode = 'bow' | 'tiller';

const KEY = 'squib.steering.v1';

export function loadSteering(): SteeringMode {
  try {
    return localStorage.getItem(KEY) === 'tiller' ? 'tiller' : 'bow';
  } catch {
    return 'bow';
  }
}

export function saveSteering(m: SteeringMode): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // storage unavailable: the choice lasts for this visit
  }
}

/** The held action ('helmLeft' turns the bow to port) for a steering control on the left or the right. */
export function helmAction(side: 'left' | 'right', mode: SteeringMode): 'helmLeft' | 'helmRight' {
  const bowLeft = mode === 'bow' ? side === 'left' : side === 'right';
  return bowLeft ? 'helmLeft' : 'helmRight';
}
