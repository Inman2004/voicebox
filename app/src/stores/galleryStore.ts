import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HistoryGroup, HistorySort, HistoryStatusFilter } from '@/lib/api/types';

export type GalleryView = 'grid' | 'list';

export interface GalleryFilters {
  profileId?: string;
  engine?: string;
  language?: string;
  status?: HistoryStatusFilter;
  favoritesOnly: boolean;
}

interface GalleryStore {
  view: GalleryView;
  sortBy: HistorySort;
  order: 'asc' | 'desc';
  groupBy: HistoryGroup;
  filters: GalleryFilters;
  setView: (view: GalleryView) => void;
  setSort: (sortBy: HistorySort, order: 'asc' | 'desc') => void;
  setGroupBy: (groupBy: HistoryGroup) => void;
  setFilter: <K extends keyof GalleryFilters>(key: K, value: GalleryFilters[K]) => void;
  clearFilters: () => void;
}

const NO_FILTERS: GalleryFilters = { favoritesOnly: false };

/** Gallery view preferences, remembered per device. */
export const useGalleryStore = create<GalleryStore>()(
  persist(
    (set) => ({
      view: 'grid',
      sortBy: 'created_at',
      order: 'desc',
      groupBy: 'date',
      filters: NO_FILTERS,
      setView: (view) => set({ view }),
      setSort: (sortBy, order) => set({ sortBy, order }),
      setGroupBy: (groupBy) => set({ groupBy }),
      setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
      clearFilters: () => set({ filters: NO_FILTERS }),
    }),
    { name: 'voicebox-gallery' },
  ),
);
