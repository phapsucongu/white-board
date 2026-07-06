import type { ButtonHTMLAttributes } from 'react';

type ToolButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon: string;
  label: string;
  filled?: boolean;
};

export function ToolButton({
  active = false,
  icon,
  label,
  filled = false,
  className = '',
  ...props
}: ToolButtonProps) {
  return (
    <button
      className={`w-10 h-10 flex items-center justify-center rounded transition-all border text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/50 ${
        active
          ? 'bg-primary text-on-primary border-primary hover:bg-primary-fixed-dim hover:text-on-primary shadow-[0_0_12px_rgba(56,189,248,0.3)]'
          : 'border-outline-variant bg-surface-container/50'
      } ${className}`}
      title={label}
      aria-label={label}
      type="button"
      {...props}
    >
      <span
        className="material-symbols-outlined text-[20px]"
        style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
      >
        {icon}
      </span>
    </button>
  );
}
