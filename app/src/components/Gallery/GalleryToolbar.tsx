import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Filter,
  LayoutGrid,
  List,
  ListChecks,
  Search,
  Star,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { VoiceAvatar } from '@/components/Generate/VoiceAvatar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SimpleTooltip } from '@/components/ui/tooltip';
import type { HistoryFacets, HistoryFacetValue, HistoryGroup, HistorySort } from '@/lib/api/types';
import { ALL_LANGUAGES, type LanguageCode } from '@/lib/constants/languages';
import { cn } from '@/lib/utils/cn';
import { type GalleryFilters, useGalleryStore } from '@/stores/galleryStore';
import { GalleryOutputFolder } from './GalleryOutputFolder';

const SORTS: HistorySort[] = [
  'created_at',
  'duration',
  'file_size',
  'generation_seconds',
  'profile_name',
  'text_length',
];
const GROUPS: HistoryGroup[] = [
  'none',
  'date',
  'profile',
  'engine',
  'length',
  'language',
  'status',
];

function FacetList({
  title,
  values,
  selected,
  onSelect,
  labelFor,
  withAvatar,
}: {
  title: string;
  values: HistoryFacetValue[];
  selected?: string;
  onSelect: (value: string | undefined) => void;
  labelFor?: (v: HistoryFacetValue) => string;
  withAvatar?: boolean;
}) {
  const { t } = useTranslation();
  if (!values.length) return null;
  return (
    <div className="space-y-1">
      <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="max-h-44 space-y-0.5 overflow-y-auto">
        <FacetOption active={!selected} onClick={() => onSelect(undefined)}>
          <span className="flex-1">{t('gallery.filters.any')}</span>
        </FacetOption>
        {values.map((v) => (
          <FacetOption
            key={v.value}
            active={selected === v.value}
            onClick={() => onSelect(v.value)}
          >
            {withAvatar && (
              <VoiceAvatar name={v.label} avatarUrl={v.avatar_url} className="h-5 w-5 ring-0" />
            )}
            <span className="flex-1 truncate">{labelFor ? labelFor(v) : v.label}</span>
            <span className="tabular-nums text-muted-foreground">{v.count}</span>
          </FacetOption>
        ))}
      </div>
    </div>
  );
}

function FacetOption({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors',
        active
          ? 'bg-accent/15 text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

interface GalleryToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  facets?: HistoryFacets;
  engineName: (engine?: string) => string;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
}

export function GalleryToolbar({
  search,
  onSearch,
  facets,
  engineName,
  selectionMode,
  onToggleSelectionMode,
}: GalleryToolbarProps) {
  const { t } = useTranslation();
  const {
    view,
    setView,
    sortBy,
    order,
    setSort,
    groupBy,
    setGroupBy,
    filters,
    setFilter,
    clearFilters,
  } = useGalleryStore();

  const activeFilters = (
    [
      ['profileId', facets?.profiles.find((p) => p.value === filters.profileId)?.label],
      ['engine', filters.engine && engineName(filters.engine)],
      [
        'language',
        filters.language && (ALL_LANGUAGES[filters.language as LanguageCode] ?? filters.language),
      ],
      ['status', filters.status && t(`gallery.status.${filters.status}`)],
    ] as [keyof GalleryFilters, string | undefined][]
  ).filter(([, label]) => !!label);
  const filterCount = activeFilters.length + (filters.favoritesOnly ? 1 : 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('gallery.search')}
            className="h-9 rounded-full pl-9 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch('')}
              aria-label={t('gallery.clearSearch')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <SimpleTooltip content={t('gallery.filters.favoritesOnly')}>
          <button
            type="button"
            onClick={() => setFilter('favoritesOnly', !filters.favoritesOnly)}
            aria-pressed={filters.favoritesOnly}
            aria-label={t('gallery.filters.favoritesOnly')}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors',
              filters.favoritesOnly
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted/60 text-muted-foreground hover:text-foreground',
            )}
          >
            <Star className={cn('h-3.5 w-3.5', filters.favoritesOnly && 'fill-current')} />
            {facets ? facets.favorites : null}
          </button>
        </SimpleTooltip>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors',
                filterCount
                  ? 'bg-accent/15 text-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:text-foreground',
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              {t('gallery.filters.title')}
              {filterCount > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[10px] text-accent-foreground">
                  {filterCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3 p-3">
            <FacetList
              title={t('gallery.filters.voice')}
              values={facets?.profiles ?? []}
              selected={filters.profileId}
              onSelect={(v) => setFilter('profileId', v)}
              withAvatar
            />
            <FacetList
              title={t('gallery.filters.engine')}
              values={facets?.engines ?? []}
              selected={filters.engine}
              onSelect={(v) => setFilter('engine', v)}
              labelFor={(v) => engineName(v.value)}
            />
            <FacetList
              title={t('gallery.filters.language')}
              values={facets?.languages ?? []}
              selected={filters.language}
              onSelect={(v) => setFilter('language', v)}
              labelFor={(v) => ALL_LANGUAGES[v.value as LanguageCode] ?? v.value}
            />
            <FacetList
              title={t('gallery.filters.status')}
              values={facets?.statuses ?? []}
              selected={filters.status}
              onSelect={(v) => setFilter('status', v as GalleryFilters['status'])}
              labelFor={(v) => t(`gallery.status.${v.value}`)}
            />
            {filterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="w-full text-center text-xs text-accent hover:underline"
              >
                {t('gallery.filters.clear')}
              </button>
            )}
          </PopoverContent>
        </Popover>

        <Select value={sortBy} onValueChange={(v) => setSort(v as HistorySort, order)}>
          <SelectTrigger
            className="h-9 w-[170px] rounded-full text-xs"
            aria-label={t('gallery.sort.label')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {t(`gallery.sort.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SimpleTooltip content={order === 'desc' ? t('gallery.sort.desc') : t('gallery.sort.asc')}>
          <button
            type="button"
            onClick={() => setSort(sortBy, order === 'desc' ? 'asc' : 'desc')}
            aria-label={order === 'desc' ? t('gallery.sort.desc') : t('gallery.sort.asc')}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 text-muted-foreground hover:text-foreground"
          >
            {order === 'desc' ? (
              <ArrowDownWideNarrow className="h-4 w-4" />
            ) : (
              <ArrowUpNarrowWide className="h-4 w-4" />
            )}
          </button>
        </SimpleTooltip>

        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as HistoryGroup)}>
          <SelectTrigger
            className="h-9 w-[150px] rounded-full text-xs"
            aria-label={t('gallery.group.label')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map((g) => (
              <SelectItem key={g} value={g} className="text-xs">
                {t(`gallery.group.${g}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          aria-label={t('gallery.view.label')}
          options={[
            {
              value: 'grid',
              label: <LayoutGrid className="h-3.5 w-3.5" />,
              title: t('gallery.view.grid'),
            },
            {
              value: 'list',
              label: <List className="h-3.5 w-3.5" />,
              title: t('gallery.view.list'),
            },
          ]}
        />

        <GalleryOutputFolder />

        <SimpleTooltip content={t('gallery.select.toggle')}>
          <button
            type="button"
            onClick={onToggleSelectionMode}
            aria-pressed={selectionMode}
            aria-label={t('gallery.select.toggle')}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
              selectionMode
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted/60 text-muted-foreground hover:text-foreground',
            )}
          >
            <ListChecks className="h-4 w-4" />
          </button>
        </SimpleTooltip>
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeFilters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key, undefined)}
              className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-xs text-foreground hover:bg-accent/25"
            >
              {label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
