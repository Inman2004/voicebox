import { useTranslation } from 'react-i18next';
import type { InferenceDiagnostics as Diagnostics } from '@/lib/api/types';

const mib = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MiB`;

export function InferenceDiagnostics({ data }: { data?: Diagnostics | null }) {
  const { t } = useTranslation();
  if (!data)
    return (
      <p className="text-xs text-muted-foreground">
        {t('inference.notObserved', 'Qwen execution not observed yet.')}
      </p>
    );
  const states = {
    cuda: t('inference.cuda', 'CUDA'),
    cpu: t('inference.cpu', 'CPU Only'),
    mixed: t('inference.mixed', 'Mixed Device'),
    cuda_oom: t('inference.oom', 'CUDA OOM'),
    unverified: t('inference.unverified', 'Not verified'),
  };
  return (
    <details className="border-t border-border pt-2 text-xs">
      <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t('inference.title', 'Neural inference')}: {states[data.actual ?? 'unverified']}
      </summary>
      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto break-words text-muted-foreground">
        <p>
          {t('inference.requested', 'Requested')}: {data.requested ?? 'auto'} · {data.stage}
        </p>
        <p>
          {data.backend ?? 'qwen_tts / PyTorch'} · {data.dtype ?? '—'} · {data.attention ?? '—'}
        </p>
        {data.failure && (
          <p role="alert" className="text-destructive">
            {data.failure.message}
          </p>
        )}
        {data.memory && (
          <dl className="grid grid-cols-2 gap-1 tabular-nums">
            <dt>{t('inference.allocated', 'Allocated')}</dt>
            <dd>{mib(data.memory.allocated_bytes)}</dd>
            <dt>{t('inference.reserved', 'Reserved')}</dt>
            <dd>{mib(data.memory.reserved_bytes)}</dd>
            <dt>{t('inference.peak', 'Peak allocated')}</dt>
            <dd>{mib(data.memory.peak_allocated_bytes)}</dd>
          </dl>
        )}
        {data.decoder && (
          <p>
            {t('inference.decoder', 'Decoder')}:{' '}
            {data.decoder.path === 'cuda_graph'
              ? t('inference.cudaGraphs', 'CUDA graphs')
              : t('inference.standardDecoder', 'Standard')}
            {data.decoder.frames_per_second
              ? ` · ${data.decoder.frames_per_second.toFixed(1)} ${t('inference.framesPerSecond', 'frames/s')} (${(data.decoder.frames_per_second / 12).toFixed(2)}× ${t('inference.realtime', 'realtime')})`
              : ''}
            {data.decoder.path === 'standard' && data.decoder.reason
              ? ` · ${data.decoder.reason}`
              : ''}
          </p>
        )}
        {data.evicted_models?.length ? (
          <p>
            {t('inference.evicted', 'Unloaded to free VRAM')}: {data.evicted_models.join(', ')}
          </p>
        ) : null}
        {data.components?.map((component) => (
          <div key={component.name}>
            <p className="text-foreground">{component.name}</p>
            <p>
              {component.devices.join(', ')} · {component.dtypes.join(', ')} ·{' '}
              {mib(component.storage_bytes)}
            </p>
            {!component.executed && (
              <p>{t('inference.notExecuted', 'Resident; execution not observed')}</p>
            )}
          </div>
        ))}
        <p>
          {t(
            'inference.cpuStages',
            'Text preparation and final audio processing use CPU. This is not model offloading.',
          )}
        </p>
        <p>
          {t(
            'inference.residency',
            'Memory counters are process-wide. Windows driver residency is not verified.',
          )}
        </p>
        <p>
          {t('inference.observed', 'Observed')}: {new Date(data.observed_at).toLocaleTimeString()}
        </p>
      </div>
    </details>
  );
}
