import { ShieldCheck } from '@/components/icons';

export function VerifiedBadge({
  className = '',
  label = false,
  size = 20,
}: {
  className?: string;
  label?: boolean;
  size?: number;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#1677d2] font-extrabold leading-none text-white shadow-[0_2px_7px_rgba(22,119,210,.28)] ${label ? 'h-7 px-2.5 text-[11px]' : ''} ${className}`}
      style={label ? undefined : { width: size, height: size }}
      title="Identity verified"
      aria-label="Identity verified"
    >
      <ShieldCheck size={label ? 14 : Math.max(12, Math.round(size * 0.68))} strokeWidth={2.6} aria-hidden="true" />
      {label ? <span>Verified</span> : null}
    </span>
  );
}
