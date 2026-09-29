import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleHelp, Download, Loader2, Pin } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { EngineId } from '@/lib/api/types';
import { ALL_LANGUAGES, type LanguageCode } from '@/lib/constants/languages';
import type { EngineWithStatus } from '@/lib/hooks/useEngines';
import { cn } from '@/lib/utils/cn';
import { useGenerationOptionsStore } from '@/stores/generationOptionsStore';
import { engineIcon } from '../engineIcons';

export function EngineBadge({ engine, size = 'md' }: { engine: EngineWithStatus; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = engineIcon(engine.icon);
  const dims = size === 'lg' ? 'h-14 w-14 rounded-2xl' : size === 'md' ? 'h-9 w-9 rounded-xl' : 'h-7 w-7 rounded-lg';
  const icon = size === 'lg' ? 'h-7 w-7' : 'h-4 w-4';
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center text-white shadow-sm', dims)}
      style={{ background: `linear-gradient(135deg, ${engine.color}, ${engine.color}bb)` }}
    >
      <Icon className={icon} />
    </div>
  );
}

/** Starts a model download; the global task watcher shows the progress toast. */
export function useStartModelDownload() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  async function start(modelName: string) {
    setPending(modelName);
    try {
      await apiClient.triggerModelDownload(modelName);
      queryClient.invalidateQueries({ queryKey: ['modelStatus'] });
    } catch (e) {
      toast({
        title: 'Download failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setPending(null);
    }
  }

  return { start, pending };
}

interface ModelPickerProps {
  engines: EngineWithStatus[];
  selected: EngineId;
  onSelect: (engine: EngineId) => void;
}

export function ModelPicker({ engines, selected, onSelect }: ModelPickerProps) {
  const { t } = useTranslation();
  const pinned = useGenerationOptionsStore((s) => s.pinnedEngines);
  const togglePinned = useGenerationOptionsStore((s) => s.togglePinnedEngine);
  const { start, pending } = useStartModelDownload();
  const [helpOpen, setHelpOpen] = useState(false);

  const ordered = useMemo(() => {
    const pinRank = (e: EngineWithStatus) => (pinned.includes(e.engine) ? 0 : 1);
    return [...engines].sort((a, b) => pinRank(a) - pinRank(b));
  }, [engines, pinned]);

  return (
    <div className="flex max-h-[70vh] w-[360px] flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h4 className="text-base font-semibold">{t('generate.model.choose')}</h4>
        <Button
          type="button"
          size="sm"
          variant={helpOpen ? 'default' : 'outline'}
          className="h-7 gap-1 px-3 text-xs"
          onClick={() => setHelpOpen((o) => !o)}
        >
          <CircleHelp className="h-3.5 w-3.5" />
          {t('generate.model.helpMeSelect')}
        </Button>
      </div>

      {helpOpen && (
        <HelpMeSelect
          engines={engines}
          onPick={(e) => {
            onSelect(e);
            setHelpOpen(false);
          }}
        />
      )}

      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {ordered.map((engine) => {
          const isSelected = engine.engine === selected;
          const isPinned = pinned.includes(engine.engine);
          const primary = engine.variants[0];
          const downloadable = engine.state === 'missing' && primary;
          return (
            // biome-ignore lint/a11y/useSemanticElements: row contains nested buttons
            <div
              key={engine.engine}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(engine.engine)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(engine.engine);
                }
              }}
              className={cn(
                'group flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected ? 'border-accent bg-accent/10' : 'border-border bg-card hover:bg-muted/50',
              )}
            >
              <EngineBadge engine={engine} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{engine.display_name}</span>
                  {isSelected && (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      {t('generate.model.selected')}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{engine.tagline}</p>
              </div>
              <SimpleTooltip content={isPinned ? t('generate.model.unpin') : t('generate.model.pin')}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinned(engine.engine);
                  }}
                  className={cn(
                    'rounded-full p-1.5 transition-colors hover:bg-muted',
                    isPinned ? 'text-accent' : 'text-muted-foreground/60',
                  )}
                  aria-pressed={isPinned}
                  aria-label={isPinned ? t('generate.model.unpin') : t('generate.model.pin')}
                >
                  <Pin className={cn('h-3.5 w-3.5', isPinned && 'fill-current')} />
                </button>
              </SimpleTooltip>
              {engine.state === 'downloading' || pending === primary?.model_name ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : downloadable ? (
                <SimpleTooltip content={t('generate.model.download', { size: formatSize(primary.size_mb) })}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void start(primary.model_name);
                    }}
                    className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t('generate.model.download', { size: formatSize(primary.size_mb) })}
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </SimpleTooltip>
              ) : isSelected ? (
                <CheckCircle2 className="h-4 w-4 text-accent" />
              ) : (
                <span className="w-7" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function formatSize(mb?: number) {
  if (!mb) return '';
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

// ── "Help me select" ──────────────────────────────────────────────────

type Priority = 'speed' | 'balanced' | 'quality';

function HelpMeSelect({
  engines,
  onPick,
}: {
  engines: EngineWithStatus[];
  onPick: (engine: EngineId) => void;
}) {
  const { t } = useTranslation();
  const [cloning, setCloning] = useState<'yes' | 'no'>('no');
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [priority, setPriority] = useState<Priority>('balanced');

  const allLanguages = useMemo(() => {
    const set = new Set<string>();
    for (const e of engines) for (const l of e.languages) set.add(l);
    return [...set].sort((a, b) =>
      (ALL_LANGUAGES[a as LanguageCode] ?? a).localeCompare(ALL_LANGUAGES[b as LanguageCode] ?? b),
    );
  }, [engines]);

  const ranked = useMemo(() => {
    return engines
      .filter((e) => e.languages.includes(language))
      .filter((e) => (cloning === 'yes' ? e.supports_cloning : true))
      .map((e) => {
        const weights = { speed: [3, 1], balanced: [2, 2], quality: [1, 3] }[priority];
        let score = e.speed_rating * weights[0] + e.quality_rating * weights[1];
        if (cloning === 'no' && e.supports_presets) score += 2; // ready-made voices
        if (e.state !== 'missing') score += 1; // already downloaded
        return { engine: e, score };
      })
      .sort((a, b) => b.score - a.score);
  }, [engines, language, cloning, priority]);

  const best = ranked[0]?.engine;

  return (
    <div className="mx-3 mb-3 space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-3 text-xs">
      <div className="space-y-1.5">
        <p className="font-medium">{t('generate.model.help.cloneQuestion')}</p>
        <Segmented
          size="sm"
          value={cloning}
          onChange={setCloning}
          options={[
            { value: 'no', label: t('generate.model.help.builtIn') },
            { value: 'yes', label: t('generate.model.help.cloneMine') },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <p className="font-medium">{t('generate.model.help.languageQuestion')}</p>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as LanguageCode)}
          className="h-8 w-full rounded-full border border-border bg-card px-3 text-xs"
        >
          {allLanguages.map((l) => (
            <option key={l} value={l}>
              {ALL_LANGUAGES[l as LanguageCode] ?? l}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <p className="font-medium">{t('generate.model.help.priorityQuestion')}</p>
        <Segmented
          size="sm"
          value={priority}
          onChange={setPriority}
          options={[
            { value: 'speed', label: t('generate.model.help.speed') },
            { value: 'balanced', label: t('generate.model.help.balanced') },
            { value: 'quality', label: t('generate.model.help.quality') },
          ]}
        />
      </div>
      {best ? (
        <div className="flex items-center gap-3 rounded-lg bg-card p-2.5">
          <EngineBadge engine={best} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{best.display_name}</p>
            <p className="truncate text-muted-foreground">{best.description}</p>
          </div>
          <Button type="button" size="sm" className="h-7 px-3 text-xs" onClick={() => onPick(best.engine)}>
            {t('generate.model.help.use')}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">{t('generate.model.help.none')}</p>
      )}
    </div>
  );
}
