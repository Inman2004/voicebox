import { FolderOpen, FolderOutput } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OutputFolderPathForm } from '@/components/OutputFolder/OutputFolderPathForm';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useOutputFolder } from '@/lib/hooks/useOutputFolder';
import { cn } from '@/lib/utils/cn';

/** Quick view/change of where new audio is saved (same setting as Settings → Generation). */
export function GalleryOutputFolder() {
  const { t } = useTranslation();
  const folder = useOutputFolder();

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) folder.setTypingFolder(null);
      }}
    >
      <SimpleTooltip content={t('gallery.outputFolder.tooltip')}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('gallery.outputFolder.tooltip')}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
              folder.hasCustomFolder
                ? 'bg-accent/15 text-foreground'
                : 'bg-muted/60 text-muted-foreground hover:text-foreground',
            )}
          >
            <FolderOutput className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent align="end" className="w-80 space-y-3 p-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('gallery.outputFolder.title')}
          </p>
          <p className="break-all font-mono text-xs">
            {folder.outputFolder ?? t('settings.generation.folder.description')}
          </p>
          <p className="text-xs text-muted-foreground">
            {folder.hasCustomFolder
              ? t('settings.generation.folder.customHint')
              : t('settings.generation.folder.defaultHint')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={folder.choose} disabled={!folder.ready}>
            {t('settings.generation.folder.change')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={folder.open}
            disabled={folder.opening || !folder.outputFolder}
          >
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
            {t('settings.generation.folder.open')}
          </Button>
          {folder.hasCustomFolder && (
            <Button size="sm" variant="ghost" onClick={() => folder.save('')}>
              {t('settings.generation.folder.useDefault')}
            </Button>
          )}
        </div>
        <OutputFolderPathForm folder={folder} />
      </PopoverContent>
    </Popover>
  );
}
