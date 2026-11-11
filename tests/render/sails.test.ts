/**
 * The drawn sails fill the way the air pushes them (the owner saw sails bellied into the wind with the wind on
 * the quarter): the old rule flipped a sail whenever the flow met its chord at more than 90°, which is the
 * normal state of an eased sail on a broad reach or run.
 */
import { describe, expect, it } from 'vitest';
import { sailFill } from '../../src/render/squibModel';
import { DEG, Simulation, autopilotHelm, buildConditions, squibParams } from '../../src/sim/index';

describe('sail fill', () => {
  it('bellies to leeward close-hauled and reaching, forward on a run, and the other way when backed', () => {
    expect(sailFill(30 * DEG, 10 * DEG)).toBeGreaterThan(0.9); // starboard tack, sail to port
    expect(sailFill(-30 * DEG, -10 * DEG)).toBeLessThan(-0.9); // port tack
    expect(sailFill(170 * DEG, 80 * DEG)).toBeGreaterThan(0.9); // run, wind on the starboard quarter, main out to port
    expect(sailFill(-170 * DEG, 80 * DEG)).toBeGreaterThan(0.9); // by the lee: still pushed forward and out
    expect(sailFill(-30 * DEG, 10 * DEG)).toBeLessThan(-0.9); // backed: wind on the boom's side
    expect(Math.abs(sailFill(10 * DEG, 10 * DEG))).toBeLessThan(1e-9); // luffing: flat
  });

  it('matches the side the physics pushes each sail to, at every wind angle on both tacks', () => {
    for (let twa = -175; twa <= 175; twa += 10) {
      const env = buildConditions({ startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 12, twdDeg: 0 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } }).env;
      const sim = new Simulation({
        params: squibParams(), env, initial: { headingDeg: -twa, speedKn: 4 },
        input: { autoMain: true, autoJib: true, autoCrew: true },
        controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: twa * DEG }) }),
      });
      sim.advance(30);
      const s = sim.snapshot();
      for (const [f, angle] of [[s.forces.main, s.boomMain], [s.forces.jib, s.boomJib]] as const) {
        // Force normal to the chord, positive to port: the chord runs aft at `angle`, port normal (sin β, −cos β).
        const fn = f.x * Math.sin(angle) - f.yPlane * Math.cos(angle);
        if (Math.abs(fn) < 5 || f.luff < 0.5) continue;
        expect(Math.sign(sailFill(f.awa, angle)), `twa ${twa}`).toBe(Math.sign(fn));
      }
    }
  });
});

/**
 * Luffing and flogging (review, 10 Nov 2026): as a sail starts to luff, the cloth just behind the mast backs first
 * (the luff bubble); a flogging sail whips hardest at its free leech.
 */
describe('the luff bubble and a flogging sail', async () => {
  const THREE = await import('three');
  const { SquibModel } = await import('../../src/render/squibModel');
  const U = 14;
  const V = 24;
  // The mainsail's offset across its chord at mid height, column u (signed, along one normal to the chord).
  const offsets = (luff: number, time: number) => {
    const m = new SquibModel(squibParams());
    const angle = 0.25;
    m.update({ main: { angle, luff, fill: -1 }, jib: { angle: -0.2, luff: 1, fill: -1 }, rudder: 0, crewY: 0, time, aws: 6 });
    let main: InstanceType<typeof THREE.Mesh> | undefined;
    m.group.traverse((o) => {
      if (!main && o.name === 'mainsail') main = o as InstanceType<typeof THREE.Mesh>;
    });
    const pos = main!.geometry.getAttribute('position');
    const row = V / 2;
    const at = (u: number) => new THREE.Vector3(pos.getX(row * (U + 1) + u), pos.getY(row * (U + 1) + u), pos.getZ(row * (U + 1) + u));
    const a = at(0);
    const b = at(U);
    const chord = b.clone().sub(a);
    // The belly's side: the chord turned a right angle, towards fill.
    const side = new THREE.Vector3(chord.z, 0, -chord.x).normalize();
    const off = (u: number) => at(u).sub(a.clone().addScaledVector(chord, u / U)).dot(side);
    return { front: off(2), mid: off(6), leech: off(U - 1) };
  };

  it('drawing, the sail bellies to leeward along its chord; starting to luff, its front backs to windward', () => {
    const full = offsets(1, 0);
    // Measured along the side the drawing sail bellies to.
    const k = Math.sign(full.mid);
    expect(k * full.mid).toBeGreaterThan(0.05);
    expect(k * full.front).toBeGreaterThan(0.01);
    const lifting = offsets(0.75, 0);
    expect(k * lifting.front).toBeLessThan(-0.005);
    // The rest of the sail still draws.
    expect(k * lifting.mid).toBeGreaterThan(0);
  });

  it('flogging, the leech moves more than the luff, and the movement varies in time', () => {
    const range = (k: 'front' | 'leech') => {
      const xs = Array.from({ length: 24 }, (_, i) => offsets(0, i * 0.037)[k]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(range('leech')).toBeGreaterThan(2 * range('front'));
    expect(range('leech')).toBeGreaterThan(0.1);
  });
});
