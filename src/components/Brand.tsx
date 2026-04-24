import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';

export function Brand({
  size = 28,
  showText = true,
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
      <Image src="/logo.png" alt="Canact" width={size} height={size} priority className="rounded-md object-contain" />
      {showText && <span className="font-extrabold tracking-tight text-brand" style={{ fontSize: Math.round(size * 0.78) }}>Canact</span>}
    </span>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function BrandMark({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <Image src="/logo.png" alt="Canact" width={size} height={size} priority className={clsx('object-contain', className)} />
  );
}
