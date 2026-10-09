import { AnimatePresence, motion } from 'framer-motion';
import {
  AudioLines,
  Download,
  FileArchive,
  Loader2,
  MoreHorizontal,
  Play,
  RotateCcw,
  Square,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AudioBars } from '@/components/AudioBars';
import { ApplyEffectsDialog } from './ApplyEffectsDialog';
import { GenerationTimeBadge, LiveGenerationLabel } from './GenerationTiming';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import type { HistoryResponse } from '@/lib/api/types';
import { BOTTOM_SAFE_AREA_PADDING } from '@/lib/constants/ui';
import { useGenerationActions } from '@/lib/hooks/useGenerationActions';
import {
  useClearFailedGenerations,
  useDeleteGeneration,
  useHistory,
  useImportGeneration,
} from '@/lib/hooks/useHistory';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatDuration, formatEngineName } from '@/lib/utils/format';
import { useGenerationStore } from '@/stores/generationStore';
import { usePlayerStore } from '@/stores/playerStore';

export function HistoryTable() {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [allHistory, setAllHistory] = useState<HistoryResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [generationToDelete, setGenerationToDelete] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [effectsTarget, setEffectsTarget] = useState<HistoryResponse | null>(null);
  const [expandedVersionsId, setExpandedVersionsId] = useState<string | null>(null);
  const limit = 20;
  const { toast } = useToast();

  const {
    data: historyData,
    isLoading,
    isFetching,
  } = useHistory({
    limit,
    offset: page * limit,
  });

  const deleteGeneration = useDeleteGeneration();
  const clearFailed = useClearFailedGenerations();
  const [clearFailedDialogOpen, setClearFailedDialogOpen] = useState(false);
  const importGeneration = useImportGeneration();
  const actions = useGenerationActions();
  const currentAudioId = actions.currentAudioId;
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const audioUrl = usePlayerStore((state) => state.audioUrl);
  const isPlayerVisible = !!audioUrl;

  // Update accumulated history when new data arrives
  useEffect(() => {
    if (historyData?.items) {
      setTotal(historyData.total);
      if (page === 0) {
        // Reset to first page
        setAllHistory(historyData.items);
      } else {
        // Append new items, avoiding duplicates
        setAllHistory((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const newItems = historyData.items.filter((item) => !existingIds.has(item.id));
          return [...prev, ...newItems];
        });
      }
    }
  }, [historyData, page]);

  // Reset to page 0 when deletions, imports, or generation completions occur
  const pendingCount = useGenerationStore((state) => state.pendingGenerationIds.size);
  const prevPendingCountRef = useRef(pendingCount);
  useEffect(() => {
    if (deleteGeneration.isSuccess || importGeneration.isSuccess || clearFailed.isSuccess) {
      setPage(0);
      setAllHistory([]);
    }
  }, [deleteGeneration.isSuccess, importGeneration.isSuccess, clearFailed.isSuccess]);

  useEffect(() => {
    // A generation finished (pending count decreased) — scroll back to show it
    if (
      prevPendingCountRef.current > 0 &&
      pendingCount < prevPendingCountRef.current &&
      page !== 0
    ) {
      setPage(0);
      setAllHistory([]);
    }
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, page]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const loadMoreEl = loadMoreRef.current;
    if (!loadMoreEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && !isFetching && allHistory.length < total) {
          setPage((prev) => prev + 1);
        }
      },
      {
        root: scrollRef.current,
        rootMargin: '100px',
        threshold: 0.1,
      },
    );

    observer.observe(loadMoreEl);
    return () => observer.disconnect();
  }, [isFetching, allHistory.length, total]);

  // Track scroll position for gradient effect
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      setIsScrolled(scrollEl.scrollTop > 0);
    };

    scrollEl.addEventListener('scroll', handleScroll);
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, []);

  const handleDeleteClick = (generationId: string, profileName: string) => {
    setGenerationToDelete({ id: generationId, name: profileName });
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (generationToDelete) {
      deleteGeneration.mutate(generationToDelete.id);
      setDeleteDialogOpen(false);
      setGenerationToDelete(null);
    }
  };

  const handleImportConfirm = () => {
    if (selectedFile) {
      importGeneration.mutate(selectedFile, {
        onSuccess: (data) => {
          setImportDialogOpen(false);
          setSelectedFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          toast({
            title: 'Generation imported',
            description: data.message || 'Generation imported successfully',
          });
        },
        onError: (error) => {
          toast({
            title: 'Failed to import generation',
            description: error.message,
            variant: 'destructive',
          });
        },
      });
    }
  };

  if (isLoading && page === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const history = allHistory;
  const hasMore = allHistory.length < total;
  const failedCount = history.filter((g) => g.status === 'failed').length;

  const handleClearFailedConfirm = () => {
    clearFailed.mutate(undefined, {
      onSuccess: (data) => {
        setClearFailedDialogOpen(false);
        toast({
          title: 'Cleared failed generations',
          description: `${data.deleted} failed ${data.deleted === 1 ? 'generation' : 'generations'} removed.`,
        });
      },
      onError: (error) => {
        setClearFailedDialogOpen(false);
        toast({
          title: 'Failed to clear',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {history.length === 0 ? (
        <div className="text-center py-12 px-5 border-2 border-dashed mb-5 border-muted rounded-md text-muted-foreground flex-1 flex items-center justify-center">
          {t('history.empty')}
        </div>
      ) : (
        <>
          {failedCount > 0 && (
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-xs text-muted-foreground">
                {failedCount} failed {failedCount === 1 ? 'generation' : 'generations'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setClearFailedDialogOpen(true)}
                disabled={clearFailed.isPending}
              >
                <Trash2 className="h-3 w-3 mr-1.5" />
                {clearFailed.isPending ? 'Clearing...' : 'Clear failed'}
              </Button>
            </div>
          )}
          {isScrolled && (
            <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
          )}
          <div
            ref={scrollRef}
            className={cn(
              'flex-1 min-h-0 overflow-y-auto space-y-2 pb-4',
              isPlayerVisible && BOTTOM_SAFE_AREA_PADDING,
            )}
          >
            {history.map((gen) => {
              const isCurrentlyPlaying = currentAudioId === gen.id && isPlaying;
              const isInProgress = gen.status === 'loading_model' || gen.status === 'generating';
              const isGenerating = isInProgress;
              const isFailed = gen.status === 'failed';
              const isPlayable = !isGenerating && !isFailed;
              const hasVersions = gen.versions && gen.versions.length > 1;
              const isVersionsExpanded = expandedVersionsId === gen.id;
              const isCancelling = actions.cancellingId === gen.id;
              return (
                <div
                  key={gen.id}
                  className={cn(
                    'border rounded-md bg-card transition-colors text-left w-full',
                    isCurrentlyPlaying && 'bg-muted/70',
                  )}
                >
                  {/* Main row */}
                  <div
                    role={isPlayable ? 'button' : undefined}
                    tabIndex={isPlayable ? 0 : undefined}
                    className={cn(
                      'flex items-stretch gap-4 h-26 p-3 outline-none',
                      isPlayable && 'hover:bg-muted/70 cursor-pointer rounded-md',
                      isVersionsExpanded && 'rounded-b-none',
                    )}
                    aria-label={
                      isGenerating
                        ? `Generating speech for ${gen.profile_name}...`
                        : isFailed
                          ? `Generation failed for ${gen.profile_name}`
                          : isCurrentlyPlaying
                            ? `Sample from ${gen.profile_name}, ${formatDuration(gen.duration ?? 0)}, ${formatDate(gen.created_at)}. Playing. Press Enter to restart.`
                            : `Sample from ${gen.profile_name}, ${formatDuration(gen.duration ?? 0)}, ${formatDate(gen.created_at)}. Press Enter to play.`
                    }
                    onMouseDown={(e) => {
                      if (!isPlayable) return;
                      const target = e.target as HTMLElement;
                      if (target.closest('textarea') || window.getSelection()?.toString()) {
                        return;
                      }
                      actions.play(gen);
                    }}
                    onKeyDown={(e) => {
                      if (!isPlayable) return;
                      const target = e.target as HTMLElement;
                      if (target.closest('textarea') || target.closest('button')) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        actions.play(gen);
                      }
                    }}
                  >
                    {/* Status icon */}
                    <div className="flex items-center shrink-0 w-10 justify-center overflow-hidden">
                      <AudioBars
                        mode={isGenerating ? 'generating' : isCurrentlyPlaying ? 'playing' : 'idle'}
                      />
                    </div>

                    {/* Left side - Meta information */}
                    <div className="flex flex-col gap-1.5 w-48 shrink-0 justify-center">
                      <div className="font-medium text-sm truncate" title={gen.profile_name}>
                        {gen.profile_name}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{gen.language}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatEngineName(gen.engine, gen.model_size)}
                        </span>
                        {isFailed ? (
                          <span className="text-xs text-destructive">Failed</span>
                        ) : !isGenerating ? (
                          <span className="text-xs text-muted-foreground">
                            {formatDuration(gen.duration ?? 0)}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {isInProgress ? (
                          <LiveGenerationLabel gen={gen} />
                        ) : (
                          <>
                            <span>{formatDate(gen.created_at)}</span>
                            <GenerationTimeBadge gen={gen} />
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right side - Transcript textarea */}
                    <div className="flex-1 min-w-0 flex">
                      <Textarea
                        value={gen.text}
                        className="flex-1 resize-none text-sm text-muted-foreground select-text"
                        readOnly
                        aria-label={`Transcript for sample from ${gen.profile_name}, ${formatDuration(gen.duration ?? 0)}`}
                      />
                    </div>

                    {/* Far right - Actions */}
                    <div
                      className="shrink-0 flex flex-col justify-center items-center gap-0.5"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground',
                          gen.is_favorited && 'text-accent hover:text-accent',
                        )}
                        aria-label={gen.is_favorited ? 'Unfavorite' : 'Favorite'}
                        onClick={() => actions.toggleFavorite(gen.id)}
                      >
                        <Star
                          className="h-2 w-2"
                          fill={gen.is_favorited ? 'currentColor' : 'none'}
                        />
                      </Button>
                      {hasVersions && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground',
                            isVersionsExpanded && 'text-accent hover:text-accent',
                          )}
                          aria-label="Toggle versions"
                          onClick={() => setExpandedVersionsId(isVersionsExpanded ? null : gen.id)}
                        >
                          <AudioLines className="h-2 w-2" />
                        </Button>
                      )}

                      {isFailed ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                            aria-label="Retry generation"
                            onClick={() => actions.retry(gen.id)}
                          >
                            <RotateCcw className="h-2 w-2" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                            aria-label="Delete generation"
                            disabled={deleteGeneration.isPending}
                            onClick={() => handleDeleteClick(gen.id, gen.profile_name)}
                          >
                            <Trash2 className="h-2 w-2" />
                          </Button>
                        </>
                      ) : isGenerating ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                          aria-label="Cancel generation"
                          disabled={isCancelling}
                          onClick={() => actions.cancel(gen.id)}
                        >
                          {isCancelling ? (
                            <Loader2 className="h-2 w-2 animate-spin" />
                          ) : (
                            <Square className="h-2 w-2" />
                          )}
                        </Button>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground/50 hover:bg-muted-foreground/20 hover:text-muted-foreground"
                              aria-label={t('history.actions.menu')}
                              disabled={isGenerating}
                            >
                              <MoreHorizontal className="h-2 w-2" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => actions.play(gen)}
                            >
                              <Play className="mr-2 h-4 w-4" />
                              {t('history.actions.play')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => actions.downloadAudio(gen)}
                              disabled={actions.isExportingAudio}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              {t('history.actions.exportAudio')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => actions.exportPackage(gen)}
                              disabled={actions.isExportingPackage}
                            >
                              <FileArchive className="mr-2 h-4 w-4" />
                              {t('history.actions.exportPackage')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEffectsTarget(gen)}>
                              <Wand2 className="mr-2 h-4 w-4" />
                              {t('history.actions.applyEffects')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => actions.regenerate(gen.id)}>
                              <RotateCcw className="mr-2 h-4 w-4" />
                              {t('history.actions.regenerate')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteClick(gen.id, gen.profile_name)}
                              disabled={deleteGeneration.isPending}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('common.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  {/* Expandable versions panel */}
                  <AnimatePresence>
                    {isVersionsExpanded && gen.versions && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-border/50">
                          <div className="divide-y divide-border/40">
                            {gen.versions.map((v) => {
                              // Show source provenance when effects were applied to a non-clean version
                              const sourceVersion = v.source_version_id
                                ? gen.versions?.find((sv) => sv.id === v.source_version_id)
                                : null;
                              const showSource =
                                sourceVersion &&
                                sourceVersion.effects_chain &&
                                sourceVersion.effects_chain.length > 0;

                              return (
                                <button
                                  key={v.id}
                                  type="button"
                                  className="flex items-center gap-2 w-full h-9 px-3 text-left hover:bg-muted/50 transition-colors"
                                  onClick={() => {
                                    actions.playVersion(gen, v.id);
                                    if (!v.is_default) {
                                      void actions.setActiveVersion(gen.id, v.id);
                                    }
                                  }}
                                >
                                  <AudioLines className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  <span className="truncate text-xs font-medium">{v.label}</span>
                                  {v.effects_chain && v.effects_chain.length > 0 && (
                                    <span className="text-[10px] text-muted-foreground truncate">
                                      {v.effects_chain.map((e) => e.type).join(' → ')}
                                    </span>
                                  )}
                                  {showSource && (
                                    <span className="text-[10px] text-muted-foreground/60 truncate">
                                      from {sourceVersion.label}
                                    </span>
                                  )}
                                  <span className="flex-1" />
                                  {v.is_default && (
                                    <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded-full">
                                      active
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {/* Load more trigger element */}
            {hasMore && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-4">
                {isFetching && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
              </div>
            )}

            {/* End of list indicator */}
            {!hasMore && history.length > 0 && (
              <div className="text-center py-4 text-xs text-muted-foreground">
                You've reached the end
              </div>
            )}
          </div>
        </>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('history.deleteDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('history.deleteDialog.body', { name: generationToDelete?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setGenerationToDelete(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteGeneration.isPending}
            >
              {deleteGeneration.isPending ? t('history.deleteDialog.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearFailedDialogOpen} onOpenChange={setClearFailedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('history.clearFailedDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('history.clearFailedDialog.body', { count: failedCount })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearFailedDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearFailedConfirm}
              disabled={clearFailed.isPending}
            >
              {clearFailed.isPending
                ? t('history.clearFailedDialog.clearing')
                : t('history.clearFailedDialog.clearAll')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('history.importDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('history.importDialog.body', { name: selectedFile?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportDialogOpen(false);
                setSelectedFile(null);
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleImportConfirm}
              disabled={importGeneration.isPending || !selectedFile}
            >
              {importGeneration.isPending
                ? t('history.importDialog.importing')
                : t('history.importDialog.action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApplyEffectsDialog generation={effectsTarget} onClose={() => setEffectsTarget(null)} />
    </div>
  );
}
