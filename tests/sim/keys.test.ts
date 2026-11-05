/**
 * The sailing keys while a control has the focus (owner review, 5 Nov 2026): after the camera was chosen from its
 * list, the list kept the keyboard, so A and D no longer steered in the helm, top-down and drone views.
 */
import { describe, expect, it } from 'vitest';
import { SimController } from '../../src/app/controller';

const el = (tagName: string, type?: string) => ({ tagName, type, isContentEditable: false }) as unknown as EventTarget;

describe('keys while a control has the focus', () => {
  it('the letter keys sail the boat from a list, a slider, a checkbox or a button', () => {
    for (const t of [el('SELECT'), el('INPUT', 'range'), el('INPUT', 'checkbox'), el('BUTTON'), el('BODY'), el('CANVAS')]) {
      for (const code of ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyQ', 'KeyE', 'KeyX', 'KeyC']) expect(SimController.keyForControl(t, code)).toBe(false);
    }
  });

  it('a list, slider or button keeps its own keys (arrows, Space, Enter)', () => {
    for (const t of [el('SELECT'), el('INPUT', 'range'), el('BUTTON')]) {
      for (const code of ['ArrowLeft', 'ArrowDown', 'Space', 'Enter', 'Home', 'End']) expect(SimController.keyForControl(t, code)).toBe(true);
    }
    // Escape closes the panels from anywhere but a text field.
    for (const t of [el('SELECT'), el('INPUT', 'range'), el('BUTTON')]) expect(SimController.keyForControl(t, 'Escape')).toBe(false);
    // Off the controls the arrows steer.
    expect(SimController.keyForControl(el('BODY'), 'ArrowLeft')).toBe(false);
  });

  it('a text field keeps every key', () => {
    for (const t of [el('INPUT', 'text'), el('INPUT', 'number'), el('INPUT', 'search'), el('TEXTAREA')]) {
      for (const code of ['KeyA', 'KeyD', 'Space', 'ArrowLeft']) expect(SimController.keyForControl(t, code)).toBe(true);
    }
    expect(SimController.keyForControl({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget, 'KeyA')).toBe(true);
  });
});
