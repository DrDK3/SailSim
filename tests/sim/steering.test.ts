import { describe, expect, it } from 'vitest';
import { helmAction } from '../../src/app/steering';

/** Decision D4 (review UX-8): which way the left and right steering controls turn the bow. */
describe('steering modes', () => {
  it('bow: left turns the bow to port, right to starboard', () => {
    expect(helmAction('left', 'bow')).toBe('helmLeft');
    expect(helmAction('right', 'bow')).toBe('helmRight');
  });
  it('tiller: left pushes the tiller to port, so the bow turns to starboard', () => {
    expect(helmAction('left', 'tiller')).toBe('helmRight');
    expect(helmAction('right', 'tiller')).toBe('helmLeft');
  });
});
