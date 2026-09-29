import type { HistoryGroup, HistoryResponse } from '@/lib/api/types';
import { ALL_LANGUAGES, type LanguageCode } from '@/lib/constants/languages';
import { parseServerDate } from '@/lib/utils/generationTiming';

export interface GalleryGroup {
  key: string;
  label: string;
  items: HistoryResponse[];
  /** Voice avatar for profile groups. */
  avatarUrl?: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

function dateBucket(createdAt: string, now: Date): { key: string; label: string } {
  const ms = parseServerDate(createdAt) ?? 0;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startOfToday) return { key: 'today', label: 'Today' };
  if (ms >= startOfToday - DAY) return { key: 'yesterday', label: 'Yesterday' };
  if (ms >= startOfToday - 6 * DAY) return { key: 'week', label: 'Earlier this week' };
  const d = new Date(ms);
  const key = `${d.getFullYear()}-${d.getMonth()}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const label = d.toLocaleDateString(undefined, { month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
  return { key, label };
}

function statusLabel(status: string): { key: string; label: string } {
  if (status === 'failed') return { key: 'failed', label: 'Failed' };
  if (status === 'generating' || status === 'loading_model') return { key: 'in_progress', label: 'In progress' };
  return { key: 'completed', label: 'Completed' };
}

/**
 * Split *items* into groups. The server orders rows by the group key first,
 * so consecutive rows with the same key form one group; a key seen again
 * later (possible for date buckets under non-date sorts) extends it.
 */
export function groupItems(
  items: HistoryResponse[],
  groupBy: HistoryGroup,
  engineName: (engine?: string) => string,
): GalleryGroup[] {
  if (groupBy === 'none') return [{ key: 'all', label: '', items }];
  const now = new Date();
  const groups = new Map<string, GalleryGroup>();
  for (const item of items) {
    let key: string;
    let label: string;
    let avatarUrl: string | null | undefined;
    switch (groupBy) {
      case 'date':
        ({ key, label } = dateBucket(item.created_at, now));
        break;
      case 'profile':
        key = item.profile_id;
        label = item.profile_name;
        avatarUrl = item.profile_avatar_url;
        break;
      case 'engine':
        key = item.engine ?? 'qwen';
        label = engineName(item.engine);
        break;
      case 'language':
        key = item.language;
        label = ALL_LANGUAGES[item.language as LanguageCode] ?? item.language;
        break;
      case 'status':
        ({ key, label } = statusLabel(item.status));
        break;
    }
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, label, items: [item], avatarUrl });
  }
  return [...groups.values()];
}
