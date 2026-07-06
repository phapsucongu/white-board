type StatusChipVariant = 'active' | 'idle' | 'error' | 'success' | 'warning';

type StatusChipProps = {
  variant: StatusChipVariant;
  label: string;
};

const variantStyles: Record<StatusChipVariant, string> = {
  active: 'bg-tertiary/10 text-tertiary border-tertiary/20',
  idle: 'bg-surface-bright text-on-surface-variant border-outline-variant',
  error: 'bg-error/10 text-error border-error/20',
  success: 'bg-tertiary/10 text-tertiary border-tertiary/20',
  warning: 'bg-secondary/10 text-secondary border-secondary/20'
};

export function StatusChip({ variant, label }: StatusChipProps) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-label-code border ${variantStyles[variant]}`}
    >
      {label}
    </span>
  );
}
