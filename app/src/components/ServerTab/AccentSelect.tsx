import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { type Accent, useUIStore } from '@/stores/uiStore';

/** Swatch colours mirror the dark-mode accents in index.css. */
const ACCENTS: { value: Accent; swatch: string }[] = [
  { value: 'magenta', swatch: 'hsl(322 75% 58%)' },
  { value: 'violet', swatch: 'hsl(265 70% 66%)' },
  { value: 'purple', swatch: 'hsl(285 60% 58%)' },
  { value: 'gold', swatch: 'hsl(43 50% 45%)' },
];

export function AccentSelect() {
  const { t } = useTranslation();
  const accent = useUIStore((s) => s.accent);
  const setAccent = useUIStore((s) => s.setAccent);

  return (
    <div className="flex items-center gap-2">
      {ACCENTS.map(({ value, swatch }) => {
        const label = t(`settings.accent.options.${value}`);
        const selected = accent === value;
        return (
          <SimpleTooltip key={value} content={label}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onClick={() => setAccent(value)}
              style={{ backgroundColor: swatch }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected && 'ring-2 ring-foreground/70',
              )}
            >
              {selected && <Check className="h-3.5 w-3.5" />}
            </button>
          </SimpleTooltip>
        );
      })}
    </div>
  );
}
