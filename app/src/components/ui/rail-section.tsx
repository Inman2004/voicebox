import { ChevronDown, CircleHelp, type LucideIcon } from 'lucide-react';
import { forwardRef, type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { SimpleTooltip } from './tooltip';

interface RailSectionProps {
  icon: LucideIcon;
  title: ReactNode;
  /** Right-aligned header controls (e.g. Presets, Reset). */
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

/** A card in the Generate settings rail. */
export function RailSection({
  icon: Icon,
  title,
  actions,
  children,
  collapsible = false,
  defaultOpen = true,
  className,
}: RailSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;

  return (
    <section className={cn('rounded-2xl border border-border bg-card/60 p-4', className)}>
      <header className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex flex-1 items-center gap-1 text-left text-sm font-semibold"
          >
            {title}
            <ChevronDown
              className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')}
            />
          </button>
        ) : (
          <h3 className="flex-1 text-sm font-semibold">{title}</h3>
        )}
        {expanded && actions && <div className="flex items-center gap-1">{actions}</div>}
      </header>
      {expanded && <div className="mt-3">{children}</div>}
    </section>
  );
}

/** Small text button used in rail headers ("Presets", "Reset", "Manage"). */
export const RailAction = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon }
>(({ icon: Icon, children, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    {...props}
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
  >
    {Icon && <Icon className="h-3.5 w-3.5" />}
    {children}
  </button>
));
RailAction.displayName = 'RailAction';

/** "(?)" icon with an explanatory tooltip. */
export function HelpHint({ children }: { children: ReactNode }) {
  return (
    <SimpleTooltip content={children}>
      <button
        type="button"
        className="inline-flex text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        aria-label="More info"
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
    </SimpleTooltip>
  );
}

/** Label + checkbox row with optional help. */
export function OptionRow({
  label,
  help,
  control,
  htmlFor,
}: {
  label: ReactNode;
  help?: ReactNode;
  control: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      {control}
      <label htmlFor={htmlFor} className="text-sm cursor-pointer select-none">
        {label}
      </label>
      {help && <HelpHint>{help}</HelpHint>}
    </div>
  );
}
