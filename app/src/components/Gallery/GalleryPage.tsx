import { chooseAudioExportFormat } from '@/stores/audioExportStore';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Download, Images, Loader2, Star, StarOff, Trash2, X } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VoiceAvatar } from '@/components/Generate/VoiceAvatar';
import { ApplyEffectsDialog } from '@/components/History/ApplyEffectsDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { HistoryResponse } from '@/lib/api/types';
import { BOTTOM_SAFE_AREA_PADDING } from '@/lib/constants/ui';
import { useEngines } from '@/lib/hooks/useEngines';
import { useGalleryFacets, useGalleryItems, useGalleryQuery } from '@/lib/hooks/useGallery';
import { useGenerationActions } from '@/lib/hooks/useGenerationActions';
import { cn } from '@/lib/utils/cn';
import { formatEngineName } from '@/lib/utils/format';
import { formatSeconds } from '@/lib/utils/generationTiming';
import { usePlatform } from '@/platform/PlatformContext';
import { useGalleryStore } from '@/stores/galleryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { GalleryCard, type GalleryItemProps, GalleryRow } from './GalleryItem';
import { GalleryToolbar } from './GalleryToolbar';
import { groupItems } from './grouping';

function isTypingTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  return !!node && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
}

export function GalleryPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const platform = usePlatform();
  const actions = useGenerationActions();
  const isPlayerVisible = !!usePlayerStore((s) => s.audioUrl);
  const { view, groupBy } = useGalleryStore();

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const query = useGalleryQuery(deferredSearch);
  const { items, total, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useGalleryItems(query);
  const { data: facets } = useGalleryFacets(query);

  const { data: engines } = useEngines();
  const engineName = useCallback(
    (engine?: string) => engines?.find((e) => e.engine === engine)?.display_name ?? formatEngineName(engine),
    [engines],
  );

  const groups = useMemo(() => groupItems(items, groupBy, engineName), [items, groupBy, engineName]);
  const groupTotals = useMemo(() => {
    const byDim = { profile: facets?.profiles, engine: facets?.engines, language: facets?.languages, status: facets?.statuses };
    const list = byDim[groupBy as keyof typeof byDim];
    return new Map((list ?? []).map((f) => [f.value, f.count]));
  }, [facets, groupBy]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // ── Selection ──────────────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const orderedIds = useMemo(() => items.map((g) => g.id), [items]);

  // Drop selections that no longer exist (deleted, filtered away).
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(orderedIds);
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [orderedIds]);

  const toggleSelect = useCallback(
    (gen: HistoryResponse, shift: boolean) => {
      setSelectionMode(true);
      setSelected((prev) => {
        const next = new Set(prev);
        if (shift && anchorRef.current) {
          const a = orderedIds.indexOf(anchorRef.current);
          const b = orderedIds.indexOf(gen.id);
          if (a !== -1 && b !== -1) {
            for (const id of orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(id);
            return next;
          }
        }
        if (next.has(gen.id)) next.delete(gen.id);
        else next.add(gen.id);
        anchorRef.current = gen.id;
        return next;
      });
    },
    [orderedIds],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectionMode(false);
    anchorRef.current = null;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape' && (selected.size || selectionMode)) clearSelection();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectionMode(true);
        setSelected(new Set(orderedIds));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, selectionMode, clearSelection, orderedIds]);

  // ── Infinite scroll ────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      { root: scrollRef.current, rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ── Bulk + destructive actions ─────────────────────────────────────
  const [effectsTarget, setEffectsTarget] = useState<HistoryResponse | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<null | 'favorite' | 'unfavorite' | 'delete' | 'zip'>(null);

  async function runBulk(action: 'favorite' | 'unfavorite' | 'delete', ids: string[]) {
    setBusy(action);
    try {
      const res = await apiClient.bulkHistoryAction(ids, action);
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      if (action === 'delete') {
        toast({ title: t('gallery.bulk.deleted', { count: res.affected }) });
        setDeleteIds(null);
        clearSelection();
      }
    } catch (e) {
      toast({ title: t('gallery.bulk.failed'), description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function downloadZip(ids: string[]) {
    setBusy('zip');
    try {
      const format = await chooseAudioExportFormat();
      if (!format) return;
      const blob = await apiClient.exportHistoryZip(ids, format);
      await platform.filesystem.saveFile(`voicebox-${ids.length}-clips.zip`, blob, [
        { name: 'ZIP archive', extensions: ['zip'] },
      ]);
    } catch (e) {
      toast({ title: t('gallery.bulk.failed'), description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  const itemProps = (gen: HistoryResponse): GalleryItemProps => ({
    gen,
    actions,
    engineName,
    selected: selected.has(gen.id),
    selectionMode,
    onToggleSelect: toggleSelect,
    onApplyEffects: setEffectsTarget,
    onDelete: (g) => setDeleteIds([g.id]),
  });

  const selectedIds = [...selected];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 pt-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <Images className="h-6 w-6" />
            {t('gallery.title')}
          </h2>
          {facets && (
            <p className="text-sm text-muted-foreground">
              {t('gallery.stats', {
                count: facets.total,
                audio: formatSeconds(facets.total_duration_seconds),
                gen: formatSeconds(facets.total_generation_seconds),
              })}
            </p>
          )}
        </div>
      </header>

      <GalleryToolbar
        search={search}
        onSearch={setSearch}
        facets={facets}
        engineName={engineName}
        selectionMode={selectionMode}
        onToggleSelectionMode={() => (selectionMode ? clearSelection() : setSelectionMode(true))}
      />

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-accent/40 bg-accent/10 px-3 py-2">
          <span className="text-sm font-medium">{t('gallery.bulk.selected', { count: selected.size })}</span>
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => setSelected(new Set(orderedIds))}
          >
            {t('gallery.bulk.selectAllLoaded', { count: orderedIds.length })}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" className="h-8 gap-1.5" disabled={!!busy} onClick={() => void runBulk('favorite', selectedIds)}>
              <Star className="h-3.5 w-3.5" />
              {t('gallery.actions.favorite')}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5" disabled={!!busy} onClick={() => void runBulk('unfavorite', selectedIds)}>
              <StarOff className="h-3.5 w-3.5" />
              {t('gallery.actions.unfavorite')}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5" disabled={!!busy} onClick={() => void downloadZip(selectedIds)}>
              {busy === 'zip' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {t('gallery.bulk.download')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={!!busy}
              onClick={() => setDeleteIds(selectedIds)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('common.delete')}
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={clearSelection} aria-label={t('gallery.bulk.clear')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-y-auto pb-6 pr-1', isPlayerVisible && BOTTOM_SAFE_AREA_PADDING)}>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-border text-center">
            <Images className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-semibold">{total === 0 && !facets?.total ? t('gallery.empty') : t('gallery.noMatches')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.key);
              return (
                <section key={group.key}>
                  {group.label && (
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                      aria-expanded={!isCollapsed}
                      className="sticky top-0 z-10 mb-2 flex w-full items-center gap-2 bg-background/95 py-1.5 text-left backdrop-blur"
                    >
                      <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isCollapsed && '-rotate-90')} />
                      {groupBy === 'profile' && (
                        <VoiceAvatar name={group.label} avatarUrl={group.avatarUrl} className="h-5 w-5 ring-0" />
                      )}
                      <span className="text-sm font-semibold">{group.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {groupTotals.get(group.key) ?? group.items.length}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {formatSeconds(group.items.reduce((s, g) => s + (g.duration ?? 0), 0))}
                      </span>
                    </button>
                  )}
                  {!isCollapsed &&
                    (view === 'grid' ? (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
                        {group.items.map((gen) => (
                          <GalleryCard key={gen.id} {...itemProps(gen)} />
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {group.items.map((gen) => (
                          <GalleryRow key={gen.id} {...itemProps(gen)} />
                        ))}
                      </div>
                    ))}
                </section>
              );
            })}
            <div ref={sentinelRef} className="flex h-10 items-center justify-center">
              {isFetchingNextPage && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
              {!hasNextPage && items.length > 0 && (
                <span className="text-xs text-muted-foreground">{t('gallery.end', { count: items.length })}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <ApplyEffectsDialog generation={effectsTarget} onClose={() => setEffectsTarget(null)} />

      <Dialog open={!!deleteIds} onOpenChange={(open) => !open && setDeleteIds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('gallery.delete.title', { count: deleteIds?.length ?? 0 })}</DialogTitle>
            <DialogDescription>{t('gallery.delete.body', { count: deleteIds?.length ?? 0 })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteIds(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={busy === 'delete'}
              onClick={() => deleteIds && void runBulk('delete', deleteIds)}
            >
              {busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
