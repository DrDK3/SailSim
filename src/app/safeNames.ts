/**
 * Safe names for ghosts, challenges and the club table (juniors round, Workstream 3): an adjective, a sea creature or
 * shore bird and a number from 1 to 99, chosen or re-rolled by the player ("Blue Heron 42"). There is never free text:
 * a name is valid only if it is exactly one of these combinations, so nobody can type a real name, a message or
 * anything rude, and the endpoint and the verifier check the same lists.
 *
 * The lists are short, positive or neutral words chosen so that no combination reads as anything else (checked by hand
 * when written; the owner may change them: names already published stay valid only while their words stay listed).
 */

export const ADJECTIVES = [
  'Blue', 'Bold', 'Brave', 'Bright', 'Brisk', 'Calm', 'Clever', 'Cosy', 'Daring', 'Eager', 'Fair', 'Gentle', 'Golden', 'Green',
  'Happy', 'Jolly', 'Keen', 'Kind', 'Lively', 'Lucky', 'Merry', 'Mighty', 'Nimble', 'Plucky', 'Proud', 'Quick', 'Quiet',
  'Rapid', 'Silver', 'Smart', 'Speedy', 'Steady', 'Sunny', 'Swift', 'Tidy', 'Trusty', 'Wise', 'Zippy',
] as const;

export const CREATURES = [
  'Anchovy', 'Avocet', 'Barnacle', 'Cockle', 'Cormorant', 'Crab', 'Curlew', 'Dolphin', 'Dunlin', 'Egret', 'Gannet',
  'Guillemot', 'Gull', 'Heron', 'Kittiwake', 'Limpet', 'Lobster', 'Mackerel', 'Mullet', 'Otter', 'Oystercatcher',
  'Pipefish', 'Plover', 'Porpoise', 'Prawn', 'Puffin', 'Razorbill', 'Redshank', 'Seahorse', 'Seal', 'Shearwater',
  'Shrimp', 'Starfish', 'Tern', 'Turnstone', 'Whelk', 'Wrasse',
] as const;

export const NAME_MAX_NUMBER = 99;

/** The name from three indices (any integers: wrapped into range). */
export function nameFrom(a: number, c: number, n: number): string {
  const ai = ((Math.trunc(a) % ADJECTIVES.length) + ADJECTIVES.length) % ADJECTIVES.length;
  const ci = ((Math.trunc(c) % CREATURES.length) + CREATURES.length) % CREATURES.length;
  const ni = (((Math.trunc(n) - 1) % NAME_MAX_NUMBER) + NAME_MAX_NUMBER) % NAME_MAX_NUMBER + 1;
  return `${ADJECTIVES[ai]} ${CREATURES[ci]} ${ni}`;
}

/** A random name (the browser's random numbers; nothing about the player goes into it). */
export function randomName(rand: () => number = Math.random): string {
  return nameFrom(Math.floor(rand() * ADJECTIVES.length), Math.floor(rand() * CREATURES.length), 1 + Math.floor(rand() * NAME_MAX_NUMBER));
}

const ADJ = new Set<string>(ADJECTIVES);
const CRE = new Set<string>(CREATURES);

/** Exactly a listed adjective, a listed creature and a number 1–99, single spaces, nothing else. */
export function isSafeName(x: unknown): x is string {
  if (typeof x !== 'string' || x.length > 40) return false;
  const m = /^([A-Z][a-z]+) ([A-Z][a-z]+) ([1-9][0-9]?)$/.exec(x);
  return !!m && ADJ.has(m[1]!) && CRE.has(m[2]!);
}

/** The parts of a valid name (for the chooser), or undefined. */
export function nameParts(x: string): { adjective: string; creature: string; number: number } | undefined {
  if (!isSafeName(x)) return undefined;
  const [adjective, creature, n] = x.split(' ') as [string, string, string];
  return { adjective, creature, number: Number(n) };
}

const KEY = 'squib.safeName.v1';

/** The name chosen on this device (made the first time it is asked for). Kept in this browser only. */
export function loadName(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (isSafeName(v)) return v;
  } catch {
    // storage unavailable
  }
  const n = randomName();
  saveName(n);
  return n;
}

export function saveName(name: string): void {
  if (!isSafeName(name)) return;
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // storage unavailable: the name lasts for this visit
  }
}
