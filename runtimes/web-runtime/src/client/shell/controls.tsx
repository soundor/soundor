import type { ComponentChildren } from 'preact';

import { ICONS, type IconName } from './icons';

export function Icon({ name }: { readonly name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

export interface IconButtonProps {
  readonly icon: IconName;
  readonly id?: string;
  /** The button's accessible name and tooltip. */
  readonly label: string;
  /** The tooltip, when it says more than the label. */
  readonly title?: string;
  readonly onClick: () => void;
  readonly pressed?: boolean;
  readonly className?: string;
  readonly children?: ComponentChildren;
  readonly [attribute: `aria-${string}` | `data-${string}`]: unknown;
}

export function IconButton({
  icon,
  label,
  title = label,
  onClick,
  pressed,
  className,
  children,
  ...attributes
}: IconButtonProps) {
  return (
    <button
      type="button"
      class={
        className === undefined ? 'soundor-icon' : `soundor-icon ${className}`
      }
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      {...attributes}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}

/** A labelled row of the panel. */
export function Row({
  label,
  id,
  children,
}: {
  readonly label: string;
  /** The control's id, which the label names. */
  readonly id?: string;
  readonly children: ComponentChildren;
}) {
  return (
    <div class="soundor-row">
      {id === undefined ? (
        <span class="soundor-label">{label}</span>
      ) : (
        <label for={id}>{label}</label>
      )}
      {children}
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ComponentChildren;
}) {
  return (
    <section class="soundor-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
