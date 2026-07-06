import type { ReactNode } from 'react';

type SectionHeadingProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export function SectionHeading({ title, subtitle, action }: SectionHeadingProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-headline-md font-semibold text-on-surface">{title}</h2>
        {subtitle && <p className="text-body-sm text-on-surface-variant">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
