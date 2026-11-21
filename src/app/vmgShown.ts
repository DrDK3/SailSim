/**
 * VMG as shown (review #19): progress straight up the wind (true wind forward of the beam) or straight down it (abaft),
 * always a positive number; the side follows the wind angle, so a beam reach does not flicker between the two. One
 * formatting for the instruments and the teaching overlay (fixes of 21 Nov 2026, §2.4: the overlay showed "VMG −4.3
 * kn" on a run while the instruments showed "VMG downwind 4.3").
 */
export function vmgShown(vmg: number, twa: number): { label: string; kn: number; title: string } {
  const up = Math.abs(twa) < Math.PI / 2;
  return {
    label: up ? 'VMG upwind' : 'VMG downwind',
    kn: Math.max(0, up ? vmg : -vmg),
    title: up ? 'Velocity made good upwind: how fast you are getting straight towards the wind' : 'Velocity made good downwind: how fast you are getting straight away from the wind',
  };
}

/** The overlay's label: "VMG upwind 3.2 kn", "VMG downwind 4.3 kn" (`vmg` in m/s; the value in knots, one decimal). */
export function vmgLabel(vmg: number, twa: number): string {
  const v = vmgShown(vmg, twa);
  return `${v.label} ${(v.kn / (1852 / 3600)).toFixed(1)} kn`;
}
