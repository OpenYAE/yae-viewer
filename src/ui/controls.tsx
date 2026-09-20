import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReactElement } from 'react';
import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon } from './icons';

export function SectionHeader(props: { title: string; meta?: ReactNode; actions?: ReactNode }): ReactElement {
  return (
    <div className="section-header">
      <span className="section-header__title">{props.title}</span>
      {props.actions ? <span className="section-header__actions">{props.actions}</span> : props.meta !== undefined ? <span className="section-header__meta">{props.meta}</span> : null}
    </div>
  );
}

export function IconButton(props: { label: string; onClick?: () => void; active?: boolean; disabled?: boolean; size?: 'sm' | 'md'; children: ReactNode; title?: string }): ReactElement {
  return (
    <button
      type="button"
      className={`icon-button ${props.size === 'md' ? 'icon-button--md' : ''} ${props.active ? 'icon-button--active' : ''}`}
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.title ?? props.label}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function SearchField(props: { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void; disabled?: boolean }): ReactElement {
  return (
    <div className="search">
      <label htmlFor={props.id} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>
        {props.label}
      </label>
      <span className="search__icon">
        <SearchIcon size={13} />
      </span>
      <input id={props.id} type="text" className="search__input" placeholder={props.placeholder} value={props.value} onChange={(e) => props.onChange(e.target.value)} disabled={props.disabled} autoComplete="off" spellCheck={false} />
      {props.value ? (
        <button type="button" className="search__clear" aria-label="Clear search" onClick={() => props.onChange('')}>
          <CloseIcon size={11} />
        </button>
      ) : null}
    </div>
  );
}

export function ToggleRow(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; tone?: 'accent' | 'teal' }): ReactElement {
  return (
    <label className={`toggle-row ${props.disabled ? 'toggle-row--disabled' : ''} ${props.tone === 'teal' && props.checked ? 'toggle-row--accent-teal' : ''}`}>
      <span className="toggle-row__label">{props.label}</span>
      <span className={`toggle ${props.tone === 'teal' ? 'toggle--teal' : ''}`}>
        <input type="checkbox" className="toggle__input" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
        <span className="toggle__track" />
        <span className="toggle__thumb" />
      </span>
    </label>
  );
}

export function SliderField(props: { id: string; label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean }): ReactElement {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <div className="slider-field">
      <div className="slider-field__head">
        <label htmlFor={props.id} className="slider-field__label">
          {props.label}
        </label>
        <span className="slider-field__value">{props.format(props.value)}</span>
      </div>
      <div className="slider">
        <div className="slider__track" />
        <div className="slider__fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        <input id={props.id} type="range" className="slider__input" min={props.min} max={props.max} step={props.step} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(Number(e.target.value))} />
      </div>
    </div>
  );
}

export function NumberRow(props: { id: string; label: string; value: number; unit: string; onCommit: (v: number) => void; min?: number; disabled?: boolean }): ReactElement {
  const [text, setText] = useState(props.value.toFixed(2));
  useEffect(() => setText(props.value.toFixed(2)), [props.value]);
  const commit = () => {
    const parsed = Number(text.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= (props.min ?? -Infinity)) props.onCommit(parsed);
    else setText(props.value.toFixed(2));
  };
  return (
    <div className="number-row">
      <label htmlFor={props.id} className="number-row__label">
        {props.label}
      </label>
      <span className="number-field">
        <input
          id={props.id}
          type="text"
          className="number-field__input"
          value={text}
          disabled={props.disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setText(props.value.toFixed(2));
          }}
        />
        <span className="number-field__unit">{props.unit}</span>
      </span>
    </div>
  );
}

export type MenuEntry = { id: string; label: string; key?: string; disabled?: boolean; separatorBefore?: boolean };

/** A chip that opens a menu below it; closes on outside click and Escape. */
export function Dropdown(props: { label: ReactNode; icon?: ReactNode; entries: MenuEntry[]; activeId?: string; onSelect: (id: string) => void; disabled?: boolean; className?: string; width?: number; ariaLabel: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={`viewport__dropdown ${props.className ?? ''}`} ref={ref}>
      <button type="button" className={`chip-button ${open ? 'chip-button--open' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={props.ariaLabel} disabled={props.disabled} onClick={() => setOpen((v) => !v)}>
        {props.icon}
        {props.label}
        {open ? <ChevronDownIcon size={11} style={{ transform: 'rotate(180deg)' }} /> : <ChevronDownIcon size={11} />}
      </button>
      {open ? (
        <div className="menu" role="menu" style={{ width: props.width ?? 190 }}>
          {props.entries.map((entry) => (
            <span key={entry.id} style={{ display: 'contents' }}>
              {entry.separatorBefore ? <span className="menu__separator" /> : null}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={entry.id === props.activeId}
                className={`menu__item ${entry.id === props.activeId ? 'menu__item--active' : ''}`}
                disabled={entry.disabled}
                onClick={() => {
                  setOpen(false);
                  props.onSelect(entry.id);
                }}
              >
                {entry.id === props.activeId ? (
                  <span className="menu__check">
                    <CheckIcon size={13} />
                  </span>
                ) : null}
                <span className="menu__label">{entry.label}</span>
                {entry.key ? <span className="menu__key">{entry.key}</span> : null}
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
