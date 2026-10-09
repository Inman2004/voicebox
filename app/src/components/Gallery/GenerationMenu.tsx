import {
  AudioLines,
  Check,
  Copy,
  Download,
  FileArchive,
  MoreHorizontal,
  PenLine,
  Play,
  RotateCcw,
  Square,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { HistoryResponse } from '@/lib/api/types';
import type { GenerationActions } from '@/lib/hooks/useGenerationActions';
import { cn } from '@/lib/utils/cn';

interface GenerationMenuProps {
  gen: HistoryResponse;
  actions: GenerationActions;
  onApplyEffects: (gen: HistoryResponse) => void;
  onDelete: (gen: HistoryResponse) => void;
  className?: string;
}

/** Every action available for one generation. */
export function GenerationMenu({ gen, actions, onApplyEffects, onDelete, className }: GenerationMenuProps) {
  const { t } = useTranslation();
  const inProgress = gen.status === 'generating' || gen.status === 'loading_model';
  const failed = gen.status === 'failed';
  const versions = gen.versions ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={t('history.actions.menu')}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        {inProgress ? (
          <DropdownMenuItem onSelect={() => actions.cancel(gen.id)}>
            <Square className="mr-2 h-4 w-4" />
            {t('gallery.actions.cancel')}
          </DropdownMenuItem>
        ) : failed ? (
          <DropdownMenuItem onSelect={() => void actions.retry(gen.id)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('gallery.actions.retry')}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => actions.play(gen)}>
              <Play className="mr-2 h-4 w-4" />
              {t('history.actions.play')}
            </DropdownMenuItem>
            {versions.length > 1 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <AudioLines className="mr-2 h-4 w-4" />
                  {t('gallery.actions.versions', { count: versions.length })}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {versions.map((v) => (
                    <DropdownMenuItem
                      key={v.id}
                      onSelect={() => {
                        actions.playVersion(gen, v.id);
                        if (!v.is_default) void actions.setActiveVersion(gen.id, v.id);
                      }}
                    >
                      <span className="flex-1 truncate">
                        {v.label}
                        {v.effects_chain?.length ? (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {v.effects_chain.map((e) => e.type).join(' → ')}
                          </span>
                        ) : null}
                      </span>
                      {v.is_default && <Check className="h-3.5 w-3.5 text-accent" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.downloadAudio(gen)} disabled={actions.isExportingAudio}>
              <Download className="mr-2 h-4 w-4" />
              {t('history.actions.exportAudio')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.exportPackage(gen)} disabled={actions.isExportingPackage}>
              <FileArchive className="mr-2 h-4 w-4" />
              {t('history.actions.exportPackage')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onApplyEffects(gen)}>
              <Wand2 className="mr-2 h-4 w-4" />
              {t('history.actions.applyEffects')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.regenerate(gen.id)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t('history.actions.regenerate')}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void actions.toggleFavorite(gen.id)}>
          <Star className={cn('mr-2 h-4 w-4', gen.is_favorited && 'fill-current text-accent')} />
          {gen.is_favorited ? t('gallery.actions.unfavorite') : t('gallery.actions.favorite')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void actions.copyText(gen)}>
          <Copy className="mr-2 h-4 w-4" />
          {t('gallery.actions.copyText')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.reuseText(gen)}>
          <PenLine className="mr-2 h-4 w-4" />
          {t('gallery.actions.reuseText')}
        </DropdownMenuItem>
        {!inProgress && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(gen)} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              {t('common.delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
