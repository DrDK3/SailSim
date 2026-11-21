import { beforeEach, describe, expect, it } from 'vitest';
import { SimController } from '../../src/app/controller';
import { levelDefaults, loadLevel } from '../../src/app/level';

/** The interface level (review U5): kept in this browser, and it sets the defaults it governs. */

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

describe('interface level', () => {
  it('is Club (the simulator as it was) until one is chosen', () => {
    expect(loadLevel()).toBe('club');
    expect(new SimController().getState().level).toBe('club');
  });

  it('Learn turns the teaching overlay and coach on and the advanced dock off; Expert shows every instrument and no coach', () => {
    const c = new SimController();
    c.setLevel('learn');
    expect(c.getState()).toMatchObject({ level: 'learn', teaching: true });
    expect(c.coachEnabled).toBe(true);
    expect(memory.get('squib.instruments.more')).toBe('0');
    expect(levelDefaults('learn').advancedDock).toBe(false);
    c.setLevel('expert');
    expect(c.getState()).toMatchObject({ level: 'expert', teaching: false });
    expect(c.coachEnabled).toBe(false);
    expect(memory.get('squib.instruments.more')).toBe('1');
    // Kept for the next visit.
    expect(new SimController().getState().level).toBe('expert');
    // Each part can still be changed by hand.
    c.toggleTeaching(true);
    expect(c.getState().teaching).toBe(true);
    expect(c.getState().level).toBe('expert');
  });
});

describe('review #20: place labels by level', () => {
  it('off at Learn and Club, on at Expert; changing the level sets them; the menu toggle still works', async () => {
    const { levelDefaults } = await import('../../src/app/level');
    const { SimController } = await import('../../src/app/controller');
    expect([levelDefaults('learn').labels, levelDefaults('club').labels, levelDefaults('expert').labels]).toEqual([false, false, true]);
    const c = new SimController();
    c.setLevel('expert');
    expect(c.getState().showLabels).toBe(true);
    c.setLevel('club');
    expect(c.getState().showLabels).toBe(false);
    c.toggleLabels();
    expect(c.getState().showLabels).toBe(true);
    c.setLevel('learn');
    expect(c.getState().showLabels).toBe(false);
  });
});
