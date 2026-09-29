import { ChevronDown, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useSystemResources } from '@/lib/hooks/useSystemResources';
import { cn } from '@/lib/utils/cn';
import { useUIStore } from '@/stores/uiStore';

function formatMb(mb?: number | null) {
  if (mb == null) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function Bar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', className)}
        style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
      />
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('truncate font-medium tabular-nums', valueClass)}>{value}</span>
    </div>
  );
}

/** Live CPU / GPU / RAM / VRAM and loaded-model readout for the sidebar. */
export function ResourcesWidget({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const expanded = useUIStore((s) => s.resourcesExpanded);
  const setExpanded = useUIStore((s) => s.setResourcesExpanded);
  const { data, isError } = useSystemResources(expanded || collapsed);

  const cpu = data?.cpu_percent ?? null;
  const gpu = data?.gpu_percent ?? null;
  const vramPct =
    data?.vram_used_mb != null && data.vram_total_mb ? (data.vram_used_mb / data.vram_total_mb) * 100 : null;
  const model = data?.loaded_models.length ? data.loaded_models.join(', ') : t('sidebar.resources.noModel');

  const dots = [
    { on: cpu != null, className: 'bg-emerald-500', label: 'CPU' },
    { on: gpu != null || data?.vram_used_mb != null, className: 'bg-emerald-500', label: 'GPU' },
    { on: !!data?.loaded_models.length, className: 'bg-sky-500', label: t('sidebar.resources.model') },
  ];

  if (collapsed) {
    return (
      <SimpleTooltip
        side="right"
        content={
          <div className="space-y-0.5">
            <p>CPU {cpu != null ? `${Math.round(cpu)}%` : '—'}</p>
            <p>GPU {gpu != null ? `${Math.round(gpu)}%` : '—'}</p>
            <p>RAM {formatMb(data?.app_ram_mb)}</p>
            <p>VRAM {formatMb(data?.vram_used_mb)}</p>
            <p>{model}</p>
          </div>
        }
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground">
          <Gauge className="h-4 w-4" />
        </div>
      </SimpleTooltip>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-xs font-medium"
      >
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">{t('sidebar.resources.title')}</span>
        <span className="flex gap-1" aria-hidden="true">
          {dots.map((d) => (
            <span
              key={d.label}
              className={cn('h-1.5 w-1.5 rounded-full', d.on && !isError ? d.className : 'bg-muted-foreground/30')}
            />
          ))}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !expanded && '-rotate-90')} />
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {isError ? (
            <p className="text-[11px] text-muted-foreground">{t('sidebar.resources.unavailable')}</p>
          ) : (
            <>
              <div className="space-y-1">
                <Row label="CPU" value={cpu != null ? `${Math.round(cpu)}%` : '—'} valueClass="text-emerald-500" />
                <Bar value={cpu} className="bg-emerald-500" />
              </div>
              <div className="space-y-1">
                <Row label="GPU" value={gpu != null ? `${Math.round(gpu)}%` : '—'} valueClass="text-emerald-500" />
                <Bar value={gpu ?? vramPct} className="bg-emerald-500" />
              </div>
              <div className="space-y-1">
                <Row label={t('sidebar.resources.appRam')} value={formatMb(data?.app_ram_mb)} valueClass="text-sky-500" />
                <Bar
                  value={
                    data?.app_ram_mb != null && data.system_ram_total_mb
                      ? (data.app_ram_mb / data.system_ram_total_mb) * 100
                      : null
                  }
                  className="bg-sky-500"
                />
              </div>
              <Row
                label="VRAM"
                value={
                  data?.vram_total_mb
                    ? `${formatMb(data.vram_used_mb)} / ${formatMb(data.vram_total_mb)}`
                    : formatMb(data?.vram_used_mb)
                }
              />
              <SimpleTooltip content={data?.gpu_name ? `${model} · ${data.gpu_name}` : model}>
                <div>
                  <Row label={t('sidebar.resources.model')} value={model} />
                </div>
              </SimpleTooltip>
            </>
          )}
        </div>
      )}
    </div>
  );
}
