/**
 * The spinnaker's colour sets (package B): the simulator's own colours, chosen in Settings for the player's boat (no
 * third-party image or pattern). Kept apart from the renderer so the preferences need no 3D code.
 */
export const SPINNAKER_COLOURS = {
  'red-white-blue': { label: 'Red, white and blue', panels: ['#c8102e', '#f5f5f2', '#1f4e79'] },
  'yellow-black': { label: 'Yellow and black', panels: ['#f2c14e', '#1b1b1b', '#f2c14e'] },
  'green-white': { label: 'Green and white', panels: ['#1e7a46', '#f5f5f2', '#1e7a46'] },
  'all-white': { label: 'White', panels: ['#f5f5f2', '#e8e8e4', '#f5f5f2'] },
} as const;
export type SpinnakerColourId = keyof typeof SPINNAKER_COLOURS;
export const DEFAULT_SPINNAKER_COLOURS: SpinnakerColourId = 'red-white-blue';
export const isSpinnakerColour = (x: unknown): x is SpinnakerColourId => typeof x === 'string' && x in SPINNAKER_COLOURS;

