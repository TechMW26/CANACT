import clsx from 'clsx';
import React from 'react';

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('rounded-2xl bg-surface border border-line p-4', className)} {...rest}>
      {children}
    </div>
  );
}
