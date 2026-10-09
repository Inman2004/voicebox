import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { OutputFolder } from '@/lib/hooks/useOutputFolder';

/** Type-a-path form, shown when the platform has no native folder picker. */
export function OutputFolderPathForm({ folder }: { folder: OutputFolder }) {
  const { t } = useTranslation();
  const { typingFolder, setTypingFolder, save } = folder;
  if (typingFolder === null) return null;
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (typingFolder.trim()) save(typingFolder.trim());
      }}
    >
      <input
        value={typingFolder}
        onChange={(e) => setTypingFolder(e.target.value)}
        placeholder="D:/Voice Outputs"
        aria-label={t('settings.generation.folder.title')}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs"
      />
      <Button type="submit" size="sm">
        {t('common.save')}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setTypingFolder(null)}>
        {t('common.cancel')}
      </Button>
    </form>
  );
}
