import { Timer } from 'lucide-react';
import { SimpleTooltip } from '@/components/ui/tooltip';
import type { HistoryResponse } from '@/lib/api/types';
import {
  formatSeconds,
  parseServerDate,
  realtimeFactor,
  useElapsed,
} from '@/lib/utils/generationTiming';
import { useGenerationStore } from '@/stores/generationStore';

/** Live "Generating… 4.2s" label for an in-progress history row. */
export function LiveGenerationLabel({ gen }: { gen: HistoryResponse }) {
  const live = useGenerationStore((s) => s.liveStatus[gen.id]);
  const status = live?.status ?? gen.status;
  const started = parseServerDate(live?.started_at ?? gen.started_at);
  const created = parseServerDate(live?.created_at ?? gen.created_at);
  const queued = started == null;
  const elapsed = useElapsed(queued ? created : started, true);
  const label = queued ? 'Queued' : status === 'loading_model' ? 'Loading model' : 'Generating';
  return (
    <span className="text-accent tabular-nums">
      {label}… {formatSeconds(elapsed)}
    </span>
  );
}

/** Compact "⏱ 3.2s" badge with a timing breakdown tooltip. */
export function GenerationTimeBadge({ gen }: { gen: HistoryResponse }) {
  if (gen.generation_seconds == null) return null;
  const rtf = realtimeFactor(gen.duration, gen.generation_seconds);
  const created = parseServerDate(gen.created_at);
  const completed = parseServerDate(gen.completed_at);
  const total = created != null && completed != null ? (completed - created) / 1000 : null;
  const lines = [
    `Synthesis: ${formatSeconds(gen.generation_seconds)}`,
    gen.load_seconds ? `Model load: ${formatSeconds(gen.load_seconds)}` : null,
    total != null ? `Total (incl. queue): ${formatSeconds(total)}` : null,
    rtf ? `${rtf.toFixed(1)}× realtime` : null,
  ].filter(Boolean);
  return (
    <SimpleTooltip content={<span className="whitespace-pre-line">{lines.join('\n')}</span>}>
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
        <Timer className="h-3 w-3" />
        {formatSeconds(gen.generation_seconds)}
      </span>
    </SimpleTooltip>
  );
}
