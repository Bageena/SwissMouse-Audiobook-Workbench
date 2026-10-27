import React from 'react';

export type AdaptiveButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: React.ReactNode;
  label: string;
  /** A short visible label for narrow controls; the accessible name stays complete. */
  compactLabel?: string;
  description?: string;
  tone?: 'neutral' | 'primary' | 'danger';
  slotClassName?: string;
};

/** The slot, rather than the viewport, decides when to simplify this command. */
export function AdaptiveButton({ icon, label, compactLabel, description, tone = 'neutral', slotClassName = '', className = '', ...props }: AdaptiveButtonProps) {
  return <span className={`adaptive-button-slot ${slotClassName}`.trim()} data-has-compact-label={Boolean(compactLabel)}><button {...props} type={props.type || 'button'} className={`adaptive-button ${className}`.trim()} data-tone={tone} aria-label={props['aria-label'] || label} title={props.title || [label, description].filter(Boolean).join(' — ')}>
    <span className="adaptive-button-icon" aria-hidden="true">{icon}</span>
    <span className="adaptive-button-copy" aria-hidden="true">
      <span className="adaptive-button-label">{label}</span>
      {compactLabel && <span className="adaptive-button-label-compact">{compactLabel}</span>}
      {description && <small>{description}</small>}
    </span>
  </button></span>;
}
