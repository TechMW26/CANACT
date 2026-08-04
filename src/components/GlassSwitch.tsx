'use client';

import clsx from 'clsx';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

export function GlassSwitch({ checked, onChange, label, disabled, className }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      data-liquid-glass="surface"
      data-liquid-radius="999"
      data-liquid-blur="0"
      data-liquid-tint="31,107,85"
      data-liquid-tint-opacity={checked ? '0.28' : '0.20'}
      className={clsx('canact-glass-switch', checked && 'canact-glass-switch-active', className)}
      onClick={() => onChange(!checked)}
    >
      <span
        aria-hidden="true"
        data-liquid-glass="switcher"
        data-liquid-radius="999"
        data-liquid-tint="255,255,255"
        data-liquid-tint-opacity="0.18"
        className="canact-glass-switch-thumb"
      />
    </button>
  );
}
