/**
 * The Class of 1866 (owner, 17 Nov 2026): the AI fleet in every race comes from four yacht clubs founded in 1866,
 * the year the Royal Dart Yacht Club was founded. A fictional invitation fleet for the sim: no club's participation,
 * affiliation or endorsement is implied, and the boats, names and sail numbers are invented (labelled "AI").
 *
 * - Royal Ulster Yacht Club, Bangor, County Down: founded 1866 as the Ulster Yacht Club, royal warrant 1869
 *   (Wikipedia). Burgee: blue, a white shield bearing the red hand of Ulster, ensigned with a crown (the club's
 *   rules, citing the Admiralty warrant of 19 February 1870; Flags of the World): docs/SOURCES.md C66-1.
 * - Kongelig Dansk Yachtklub (the Royal Danish Yacht Club), Copenhagen: founded 3 July 1866 as Dansk Forening for
 *   Lystsejlads (Flags of the World). Burgee: white, three red five-pointed stars (two over one) below a royal crown
 *   in its colours, the whole in the middle of the burgee (Lloyd's Register of Yachts 1902–03, unchanged since, per
 *   Flags of the World): C66-2.
 * - Boston Yacht Club, Marblehead, Massachusetts: founded 1866 (Flags of the World). Burgee
 *   since 1904: white, with a cross of blue (the horizontal arm) and red (the vertical arms, over it), a white star
 *   where they cross (Flags of the World, from the club's website): C66-3.
 * - Atlantic Yacht Club, Brooklyn, New York: organised in 1866 (Wikipedia). Burgee: white, a red border along its
 *   upper and lower edges and a red bar across near the hoist (a red "A"), as Wikimedia Commons draws it ("Burgee of
 *   Atlantic YC.svg"); no written description was found: C66-4.
 *
 * Their hull paint is taken from each club's colours (its burgee's): the choice of which colour goes on the
 * topsides, the stripe and the boot top is ours (E).
 */

export type ClubId = 'ruyc' | 'kdy' | 'byc' | 'ayc';

export interface RaceClub {
  id: ClubId;
  name: string;
  /** For labels and the transom. */
  short: string;
  place: string;
  founded: 1866;
  /** Hull paint (sRGB hex strings): topsides, sheer stripe, boot top (E, from the club's colours). */
  paint: { topsides: string; stripe: string; boot: string };
  /** A colour to mark the club's boats in the minimap and the results (0xRRGGBB). */
  mark: number;
}

export const CLASS_OF_1866: readonly RaceClub[] = [
  { id: 'ruyc', name: 'Royal Ulster Yacht Club', short: 'RUYC', place: 'Bangor, County Down', founded: 1866, paint: { topsides: '#1b2d5a', stripe: '#f4f3ee', boot: '#c8102e' }, mark: 0x3a62c4 },
  { id: 'kdy', name: 'Kongelig Dansk Yachtklub', short: 'KDY', place: 'Copenhagen', founded: 1866, paint: { topsides: '#c8102e', stripe: '#f4f3ee', boot: '#f4f3ee' }, mark: 0xd42a3c },
  { id: 'byc', name: 'Boston Yacht Club', short: 'BYC', place: 'Marblehead, Massachusetts', founded: 1866, paint: { topsides: '#f4f3ee', stripe: '#1f4e9e', boot: '#c8102e' }, mark: 0x8fb8f0 },
  { id: 'ayc', name: 'Atlantic Yacht Club', short: 'AYC', place: 'Brooklyn, New York', founded: 1866, paint: { topsides: '#f4f3ee', stripe: '#c8102e', boot: '#c8102e' }, mark: 0xf0e6d2 },
];

export function raceClub(id: string | undefined): RaceClub | undefined {
  return CLASS_OF_1866.find((c) => c.id === id);
}

/**
 * The `i`th AI boat (from 0): its club in turn (Royal Ulster, KDY, Boston, Atlantic, then round again, so every
 * fleet mixes the clubs), its name (the club's short name and its number in that club's team) and an invented sail
 * number, labelled "AI".
 */
export function class1866Entry(i: number): { club: ClubId; name: string; sailNumber: string; colour: number } {
  const club = CLASS_OF_1866[i % CLASS_OF_1866.length]!;
  const k = Math.floor(i / CLASS_OF_1866.length) + 1;
  return { club: club.id, name: `${club.short} ${k}`, sailNumber: `AI${String(i + 1).padStart(2, '0')}`, colour: club.mark };
}
