import { useQuery } from '@tanstack/react-query';
import { AlertCircle, AudioLines, Clock, Gauge, Loader2, Play, Timer, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { apiClient } from '@/lib/api/client';
import {
  formatSeconds,
  parseServerDate,
  realtimeFactor,
  useElapsed,
} from '@/lib/utils/generationTiming';
import { type LiveGenerationStatus, useGenerationStore } from '@/stores/generationStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSession } from './useGenerateSession';

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Clock; label: string; value: ReactNode; hint?: string }) {
  const body = (
    <div className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="leading-tight">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
  return hint ? <SimpleTooltip content={hint}>{body}</SimpleTooltip> : body;
}

/** Shows the most recent generation from this screen, with a live timer. */
export function ResultPanel({ generationId }: { generationId: string | null }) {
  const { t } = useTranslation();
  const { engine } = useSession();
  const live = useGenerationStore((s) => (generationId ? s.liveStatus[generationId] : undefined));
  const setAudioWithAutoPlay = usePlayerStore((s) => s.setAudioWithAutoPlay);

  // The SSE stream covers live updates; this fills in text/engine and
  // covers the gap before the first event arrives.
  const { data: generation } = useQuery({
    queryKey: ['history', 'item', generationId, live?.status],
    queryFn: () => apiClient.getGeneration(generationId as string),
    enabled: !!generationId,
  });

  const status: LiveGenerationStatus['status'] | undefined = live?.status ?? generation?.status;
  const running = status === 'generating' || status === 'loading_model';
  const createdMs = parseServerDate(live?.created_at ?? generation?.created_at);
  const startedMs = parseServerDate(live?.started_at ?? generation?.started_at);
  const completedMs = parseServerDate(live?.completed_at ?? generation?.completed_at);
  const queued = running && startedMs == null;

  const elapsed = useElapsed(queued ? createdMs : startedMs, running);

  if (!generationId) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-border bg-card/30 p-6 text-center">
        <AudioLines className="h-6 w-6 text-muted-foreground/60" />
        <p className="text-sm font-semibold">{t('generate.result.empty')}</p>
        <p className="text-xs text-muted-foreground">{t('generate.result.emptyHint')}</p>
      </div>
    );
  }

  const loadSeconds = live?.load_seconds ?? generation?.load_seconds ?? null;
  const genSeconds = live?.generation_seconds ?? generation?.generation_seconds ?? null;
  const duration = live?.duration ?? generation?.duration ?? null;
  const rtf = realtimeFactor(duration, genSeconds);
  const totalSeconds = createdMs != null && completedMs != null ? (completedMs - createdMs) / 1000 : null;
  const queuedSeconds = createdMs != null && startedMs != null ? (startedMs - createdMs) / 1000 : null;
  const chars = generation?.text.length;

  return (
    <div className="rounded-3xl border border-border bg-card/60 p-4">
      <div className="flex items-center gap-3">
        {running ? (
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
        ) : status === 'failed' ? (
          <AlertCircle className="h-5 w-5 text-destructive" />
        ) : (
          <AudioLines className="h-5 w-5 text-accent" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {queued
              ? t('generate.result.queued')
              : status === 'loading_model'
                ? t('generate.result.loadingModel')
                : status === 'generating'
                  ? t('generate.result.generating')
                  : status === 'failed'
                    ? t('generate.result.failed')
                    : t('generate.result.done', { time: formatSeconds(genSeconds) })}
          </p>
          {generation?.text && (
            <p className="truncate text-xs text-muted-foreground">{generation.text}</p>
          )}
        </div>
        {running && elapsed != null && (
          <span className="rounded-full bg-accent/15 px-3 py-1 font-mono text-sm font-semibold tabular-nums text-accent">
            {formatSeconds(elapsed)}
          </span>
        )}
        {status === 'completed' && (
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              setAudioWithAutoPlay(
                apiClient.getAudioUrl(generationId),
                generationId,
                generation?.profile_id ?? '',
                generation?.text.slice(0, 50),
              )
            }
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {t('generate.result.play')}
          </Button>
        )}
      </div>

      {status === 'failed' && (live?.error || generation?.error) && (
        <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {live?.error || generation?.error}
        </p>
      )}

      {(running || status === 'completed') && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {status === 'completed' ? (
            <>
              <Stat
                icon={Timer}
                label={t('generate.result.generationTime')}
                value={formatSeconds(genSeconds)}
                hint={t('generate.result.breakdown', {
                  total: formatSeconds(totalSeconds),
                  queued: formatSeconds(queuedSeconds),
                  load: formatSeconds(loadSeconds),
                  synth: formatSeconds(genSeconds),
                })}
              />
              <Stat icon={AudioLines} label={t('generate.result.audioLength')} value={formatSeconds(duration)} />
              <Stat
                icon={Zap}
                label={t('generate.result.speed')}
                value={rtf ? t('generate.result.realtime', { factor: rtf.toFixed(1) }) : '—'}
                hint={t('generate.result.speedHint')}
              />
              <Stat
                icon={Gauge}
                label={t('generate.result.modelLoad')}
                value={loadSeconds ? formatSeconds(loadSeconds) : t('generate.result.warm')}
              />
            </>
          ) : (
            <>
              <Stat icon={Clock} label={t('generate.result.elapsed')} value={formatSeconds(elapsed)} />
              <Stat
                icon={Gauge}
                label={t('generate.result.modelLoad')}
                value={
                  status === 'loading_model'
                    ? t('generate.result.inProgress')
                    : loadSeconds
                      ? formatSeconds(loadSeconds)
                      : queued
                        ? '—'
                        : t('generate.result.warm')
                }
              />
              <Stat
                icon={AudioLines}
                label={t('generate.result.engine')}
                value={engine?.display_name ?? generation?.engine ?? '—'}
              />
              <Stat
                icon={Zap}
                label={t('generate.result.characters')}
                value={chars != null ? chars.toLocaleString() : '—'}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
