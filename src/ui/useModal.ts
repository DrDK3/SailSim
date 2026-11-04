import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The open modals, the newest last: only the top one answers keys that come from outside every dialog. */
const openModals: HTMLElement[] = [];

/**
 * A modal dialog's keyboard behaviour (review UX-2, WAI-ARIA dialog pattern):
 *  - everything else in the app is `inert` while it is open, so Tab, a screen reader's cursor and clicks stay in it;
 *  - focus moves into it on open (an element marked autofocus, else the first heading, else the first control),
 *    unless something inside already has it;
 *  - Tab and Shift+Tab wrap round inside it;
 *  - Escape closes it (when `onClose` is given);
 *  - on close, focus goes back where it was, so the sailing keys and the toolbar carry on as before.
 * Dialogs opened on top of each other each restore what they changed, in turn.
 */
export function useModal(ref: RefObject<HTMLElement | null>, onClose?: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  // Where focus was when the dialog opened: read on the first render, before an autofocus inside it takes focus.
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = opener.current;
    const host = el.parentElement ?? document.body;
    const others = [...host.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== el);
    const wasInert = others.map((o) => o.inert);
    for (const o of others) o.inert = true;
    if (!el.contains(document.activeElement)) {
      const target = el.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? el.querySelector<HTMLElement>('h2, h3') ?? el.querySelector<HTMLElement>(FOCUSABLE);
      if (target && !target.matches(FOCUSABLE) && !target.hasAttribute('tabindex')) target.tabIndex = -1;
      target?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && close.current) {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!el.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // Keys pressed while focus has fallen out of the dialog (onto the page itself): the top dialog answers them.
    const onStray = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] === el && !(e.target instanceof Node && el.contains(e.target))) onKey(e);
    };
    openModals.push(el);
    el.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onStray);
    return () => {
      openModals.splice(openModals.indexOf(el), 1);
      el.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onStray);
      others.forEach((o, i) => (o.inert = wasInert[i]!));
      if (before?.isConnected) before.focus();
    };
  }, [ref]);
}
