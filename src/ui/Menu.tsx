import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  /** Starts a new section with this heading (not focusable; read out as the group's name). */
  section?: string;
  /** Keyboard shortcut shown beside the label. */
  keys?: string;
  /** A toggle (menuitemcheckbox) when set. */
  checked?: boolean;
  onSelect: () => void;
}

/**
 * A toolbar dropdown: a button that opens a list of commands (WAI-ARIA menu button pattern). Arrow keys move
 * between items, Escape or a click outside closes it, and choosing an item closes it.
 */
export function Menu({ label, items, title, icon }: { label: string; items: MenuItem[]; title?: string; icon?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  const move = (e: React.KeyboardEvent) => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') els[(i + 1) % els.length]?.focus();
    else if (e.key === 'ArrowUp') els[(i - 1 + els.length) % els.length]?.focus();
    else if (e.key === 'Escape') {
      setOpen(false);
      root.current?.querySelector<HTMLElement>('button')?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="menu" ref={root}>
      <button aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen(!open)}>
        {icon && <span className="icon" aria-hidden="true">{icon}</span>}
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu-list panel" role="menu" aria-label={label} ref={list} onKeyDown={move}>
          {items.map((it) => [
            it.section && (
              <div key={`s-${it.section}`} className="menu-section" role="presentation">
                {it.section}
              </div>
            ),
            <button
              key={it.label}
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              <span className="menu-check" aria-hidden="true">{it.checked ? '✓' : ''}</span>
              <span className="menu-label">{it.label}</span>
              {it.keys && <kbd>{it.keys}</kbd>}
            </button>,
          ])}
        </div>
      )}
    </div>
  );
}
