import { AlertCircle, Check, Pause, Play, Star } from 'lucide-react';
import type { MouseEvent } from 'react';
import { AudioBars } from '@/components/AudioBars';
import { VoiceAvatar } from '@/components/Generate/VoiceAvatar';
import { GenerationTimeBadge, LiveGenerationLabel } from '@/components/History/GenerationTiming';
import { SimpleTooltip } from '@/components/ui/tooltip';
import type { HistoryResponse } from '@/lib/api/types';
import type { GenerationActions } from '@/lib/hooks/useGenerationActions';
import { cn } from '@/lib/utils/cn';
import { formatAbsoluteDate, formatDate, formatDuration, formatFileSize } from '@/lib/utils/format';
import { usePlayerStore } from '@/stores/playerStore';
import { GenerationMenu } from './GenerationMenu';

export interface GalleryItemProps {
  gen: HistoryResponse;
  actions: GenerationActions;
  engineName: (engine?: string) => string;
  selected: boolean;
  selectionMode: boolean;
  /** shift=true extends the selection as a range. */
  onToggleSelect: (gen: HistoryResponse, shift: boolean) => void;
  onApplyEffects: (gen: HistoryResponse) => void;
  onDelete: (gen: HistoryResponse) => void;
}

function useItemState(gen: HistoryResponse) {
  const isCurrent = usePlayerStore((s) => s.audioId === gen.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying) && isCurrent;
  const inProgress = gen.status === 'generating' || gen.status === 'loading_model';
  const failed = gen.status === 'failed';
  return { isCurrent, isPlaying, inProgress, failed, playable: !inProgress && !failed };
}

function SelectBox({
  gen,
  selected,
  visible,
  onToggle,
  className,
}: {
  gen: HistoryResponse;
  selected: boolean;
  visible: boolean;
  onToggle: GalleryItemProps['onToggleSelect'];
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Select “${gen.text.slice(0, 40)}”`}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onToggle(gen, e.shiftKey);
      }}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all',
        selected
          ? 'border-accent bg-accent text-accent-foreground'
          : 'border-muted-foreground/40 bg-background/60',
        visible || selected
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        className,
      )}
    >
      {selected && <Check className="h-3 w-3" />}
    </button>
  );
}

function PlayButton({
  gen,
  actions,
  size = 'md',
}: {
  gen: HistoryResponse;
  actions: GenerationActions;
  size?: 'sm' | 'md';
}) {
  const { isPlaying, playable, failed } = useItemState(gen);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const dims = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  if (failed) {
    return (
      <SimpleTooltip content={gen.error || 'Generation failed'}>
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive',
            dims,
          )}
        >
          <AlertCircle className="h-4 w-4" />
        </span>
      </SimpleTooltip>
    );
  }
  return (
    <button
      type="button"
      disabled={!playable}
      onClick={(e) => {
        e.stopPropagation();
        if (isPlaying) setIsPlaying(false);
        else actions.play(gen);
      }}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
        isPlaying
          ? 'bg-accent text-accent-foreground'
          : 'bg-foreground/90 text-background hover:bg-foreground',
        dims,
      )}
    >
      {isPlaying ? (
        <Pause className="h-3.5 w-3.5 fill-current" />
      ) : (
        <Play className="h-3.5 w-3.5 fill-current" />
      )}
    </button>
  );
}

function FavoriteStar({ gen, actions }: { gen: HistoryResponse; actions: GenerationActions }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void actions.toggleFavorite(gen.id);
      }}
      aria-pressed={!!gen.is_favorited}
      aria-label={gen.is_favorited ? 'Unfavorite' : 'Favorite'}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted',
        gen.is_favorited ? 'text-accent' : 'text-muted-foreground/50 hover:text-foreground',
      )}
    >
      <Star className={cn('h-3.5 w-3.5', gen.is_favorited && 'fill-current')} />
    </button>
  );
}

function Meta({
  gen,
  engineName,
}: {
  gen: HistoryResponse;
  engineName: GalleryItemProps['engineName'];
}) {
  return (
    <>
      {gen.status === 'completed' && gen.duration != null && (
        <span className="tabular-nums">{formatDuration(gen.duration)}</span>
      )}
      {gen.status === 'completed' && gen.file_size != null && (
        <span className="tabular-nums">{formatFileSize(gen.file_size)}</span>
      )}
      <span className="truncate">{engineName(gen.engine)}</span>
      <span className="uppercase">{gen.language}</span>
      <GenerationTimeBadge gen={gen} />
    </>
  );
}

/** Compact tile for the grid view. */
export function GalleryCard(props: GalleryItemProps) {
  const { gen, actions, engineName, selected, selectionMode, onToggleSelect } = props;
  const { isCurrent, isPlaying, inProgress, playable } = useItemState(gen);

  return (
    // biome-ignore lint/a11y/useSemanticElements: card contains nested buttons
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if (selectionMode) onToggleSelect(gen, e.shiftKey);
        else if (playable) actions.play(gen);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (selectionMode) onToggleSelect(gen, e.shiftKey);
          else if (playable) actions.play(gen);
        }
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2 rounded-2xl border bg-card/60 p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-accent bg-accent/10'
          : isCurrent
            ? 'border-accent/50'
            : 'border-border hover:bg-muted/40',
      )}
    >
      <div className="flex items-center gap-2">
        {/* The checkbox sits over the avatar so it takes no space until needed. */}
        <div className="relative shrink-0">
          <VoiceAvatar
            name={gen.profile_name}
            avatarUrl={gen.profile_avatar_url}
            className={cn(
              'h-7 w-7 transition-opacity',
              (selected || selectionMode) && 'opacity-30',
            )}
          />
          <SelectBox
            gen={gen}
            selected={selected}
            visible={selectionMode}
            onToggle={onToggleSelect}
            className="absolute inset-0 m-auto"
          />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{gen.profile_name}</p>
          <SimpleTooltip content={formatAbsoluteDate(gen.created_at)}>
            <p className="truncate text-[11px] text-muted-foreground">
              {formatDate(gen.created_at)}
            </p>
          </SimpleTooltip>
        </div>
        <FavoriteStar gen={gen} actions={actions} />
      </div>

      <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-muted-foreground">
        {gen.text}
      </p>

      <div className="flex items-center gap-2">
        <PlayButton gen={gen} actions={actions} />
        {isPlaying ? (
          <div className="h-6 w-10 overflow-hidden">
            <AudioBars mode="playing" />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          {inProgress ? (
            <LiveGenerationLabel gen={gen} />
          ) : (
            <Meta gen={gen} engineName={engineName} />
          )}
        </div>
        <GenerationMenu
          gen={gen}
          actions={actions}
          onApplyEffects={props.onApplyEffects}
          onDelete={props.onDelete}
        />
      </div>
    </div>
  );
}

/** Dense single-line row for the list view. */
export function GalleryRow(props: GalleryItemProps) {
  const { gen, actions, engineName, selected, selectionMode, onToggleSelect } = props;
  const { isCurrent, inProgress, playable } = useItemState(gen);

  return (
    // biome-ignore lint/a11y/useSemanticElements: row contains nested buttons
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if (selectionMode) onToggleSelect(gen, e.shiftKey);
        else if (playable) actions.play(gen);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (selectionMode) onToggleSelect(gen, e.shiftKey);
          else if (playable) actions.play(gen);
        }
      }}
      className={cn(
        'group flex h-12 cursor-pointer items-center gap-3 rounded-xl px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'bg-accent/10' : isCurrent ? 'bg-muted/60' : 'hover:bg-muted/40',
      )}
    >
      <SelectBox gen={gen} selected={selected} visible={selectionMode} onToggle={onToggleSelect} />
      <PlayButton gen={gen} actions={actions} size="sm" />
      <VoiceAvatar name={gen.profile_name} avatarUrl={gen.profile_avatar_url} className="h-6 w-6" />
      <span className="w-28 shrink-0 truncate text-sm font-medium">{gen.profile_name}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{gen.text}</span>
      <div className="hidden w-56 shrink-0 items-center justify-end gap-3 text-xs text-muted-foreground xl:flex">
        {inProgress ? (
          <LiveGenerationLabel gen={gen} />
        ) : (
          <Meta gen={gen} engineName={engineName} />
        )}
      </div>
      <SimpleTooltip content={formatAbsoluteDate(gen.created_at)}>
        <span className="hidden w-24 shrink-0 truncate text-right text-xs text-muted-foreground lg:block">
          {formatDate(gen.created_at)}
        </span>
      </SimpleTooltip>
      <FavoriteStar gen={gen} actions={actions} />
      <GenerationMenu
        gen={gen}
        actions={actions}
        onApplyEffects={props.onApplyEffects}
        onDelete={props.onDelete}
      />
    </div>
  );
}
