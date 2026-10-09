import { Link } from '@tanstack/react-router';
import { ChevronDown, Download, Library, Loader2, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag } from '@/components/ui/flag';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RailSection } from '@/components/ui/rail-section';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EngineId } from '@/lib/api/types';
import type { LanguageCode } from '@/lib/constants/languages';
import { variantState } from '@/lib/hooks/useEngines';
import { useGenerationOptionsStore } from '@/stores/generationOptionsStore';
import { useSession } from '../useGenerateSession';
import { EngineBadge, formatSize, ModelPicker, useStartModelDownload } from './ModelPicker';

export function ModelSection() {
  const { t } = useTranslation();
  const session = useSession();
  const { engine, engines, variant, variantStatus } = session;
  const setEngine = useGenerationOptionsStore((s) => s.setEngine);
  const setModelSize = useGenerationOptionsStore((s) => s.setModelSize);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { start, pending } = useStartModelDownload();

  const state = variantState(variantStatus);

  return (
    <RailSection
      icon={Volume2}
      title={t('generate.model.title')}
      actions={
        <Link
          to="/models"
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Library className="h-3.5 w-3.5" />
          {t('generate.model.manage')}
        </Link>
      }
    >
      {engine ? (
        <div
          className="relative overflow-hidden rounded-2xl border p-4"
          style={{
            borderColor: `${engine.color}66`,
            background: `radial-gradient(120% 90% at 0% 0%, ${engine.color}33, transparent 60%), hsl(var(--card))`,
          }}
        >
          <div className="flex justify-end">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg bg-background/70 px-3 py-1.5 text-xs font-medium backdrop-blur hover:bg-background"
                >
                  {t('generate.model.change')}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-auto rounded-2xl p-0">
                <ModelPicker
                  engines={engines ?? []}
                  selected={engine.engine}
                  onSelect={(e: EngineId) => {
                    setEngine(e);
                    setPickerOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="mt-2 flex items-center gap-4">
            <EngineBadge engine={engine} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{engine.display_name}</p>
              <p className="text-xs text-muted-foreground">{engine.tagline}</p>
            </div>
          </div>

          {engine.variants.length > 1 && variant && (
            <Segmented
              size="sm"
              className="mt-3 w-full"
              aria-label={t('generate.model.size')}
              value={variant.model_size}
              onChange={(size) => setModelSize(engine.engine, size)}
              options={engine.variants.map((v) => ({
                value: v.model_size,
                label: v.model_size,
                title: `${v.display_name} · ${formatSize(v.size_mb)}`,
              }))}
            />
          )}

          {variant && (state === 'missing' || state === 'downloading') && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-background/60 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                {state === 'downloading'
                  ? t('generate.model.downloading')
                  : t('generate.model.notDownloaded', { size: formatSize(variant.size_mb) })}
              </span>
              {state === 'missing' && (
                <button
                  type="button"
                  disabled={pending === variant.model_name}
                  onClick={() => void start(variant.model_name)}
                  className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
                >
                  {pending === variant.model_name ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  {t('generate.model.downloadShort')}
                </button>
              )}
              {state === 'downloading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </div>
          )}
        </div>
      ) : (
        <div className="h-36 animate-pulse rounded-2xl bg-muted/50" />
      )}

      <div className="mt-4 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t('generate.model.outputLanguage')}</p>
        <Select value={session.language} onValueChange={(v) => session.setLanguage(v as LanguageCode)}>
          <SelectTrigger className="h-9 rounded-lg bg-muted/40">
            <div className="flex items-center gap-2">
              <Flag locale={session.language} />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent>
            {session.languageOptions.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </RailSection>
  );
}
