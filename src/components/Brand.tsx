import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';

export function Brand({
  size = 28,
  href,
  className,
}: {
  size?: number;
  showText?: boolean;
  href?: string;
  className?: string;
}) {
  const inner = (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <CanactIcon size={size} />
    </span>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function BrandMark({ size = 96, className }: { size?: number; className?: string }) {
  return <CanactIcon size={size} className={className} />;
}

function CanactIcon({ size, className }: { size: number; className?: string }) {
  return (
    <span
      className={clsx('relative inline-block shrink-0', className)}
      style={{ width: size * 1.8, height: size }}
      aria-label="Canact"
      role="img"
    >
      <Image
        src="/Canact-logo.png"
        alt="Canact"
        fill
        priority
        className="object-contain object-center"
        sizes={`${Math.round(size * 1.8)}px`}
      />
    </span>
  );
}
