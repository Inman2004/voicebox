import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiClient } from '@/lib/api/client';
import type { HistoryQuery } from '@/lib/api/types';
import { useGalleryStore } from '@/stores/galleryStore';

const PAGE_SIZE = 60;

/** The history query the Gallery's current sort / group / filters describe. */
export function useGalleryQuery(search: string): Omit<HistoryQuery, 'limit' | 'offset'> {
  const { sortBy, order, groupBy, filters } = useGalleryStore();
  return useMemo(
    () => ({
      search: search.trim() || undefined,
      profile_id: filters.profileId,
      engine: filters.engine,
      language: filters.language,
      status: filters.status,
      favorites_only: filters.favoritesOnly || undefined,
      sort_by: sortBy,
      order,
      group_by: groupBy,
    }),
    [search, sortBy, order, groupBy, filters],
  );
}

/** Paged gallery items. Lives under ['history'] so generation/delete refreshes reach it. */
export function useGalleryItems(query: Omit<HistoryQuery, 'limit' | 'offset'>) {
  const result = useInfiniteQuery({
    queryKey: ['history', 'gallery', query],
    queryFn: ({ pageParam }) => apiClient.listHistory({ ...query, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => {
    // Rows can shift between pages while new generations land; de-dupe by id.
    const seen = new Set<string>();
    return (result.data?.pages ?? []).flatMap((p) => p.items).filter((g) => !seen.has(g.id) && seen.add(g.id));
  }, [result.data]);
  return { ...result, items, total: result.data?.pages[0]?.total ?? 0 };
}

export function useGalleryFacets(query: Omit<HistoryQuery, 'limit' | 'offset'>) {
  const { sort_by: _s, order: _o, group_by: _g, ...filters } = query;
  return useQuery({
    queryKey: ['history', 'facets', filters],
    queryFn: () => apiClient.getHistoryFacets(filters),
    placeholderData: keepPreviousData,
  });
}
