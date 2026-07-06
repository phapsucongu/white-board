type PageHeadingProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
};

export function PageHeading({ eyebrow, title, subtitle }: PageHeadingProps) {
  return (
    <div className="mb-8">
      {eyebrow && (
        <p className="text-label-mono uppercase tracking-wider text-on-surface-variant mb-1">
          {eyebrow}
        </p>
      )}
      <h1 className="text-headline-lg font-semibold text-on-surface">{title}</h1>
      {subtitle && <p className="text-body-sm text-on-surface-variant mt-1">{subtitle}</p>}
    </div>
  );
}
