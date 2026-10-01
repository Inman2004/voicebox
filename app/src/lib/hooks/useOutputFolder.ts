import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/ui/use-toast';
import { useGenerationSettings } from '@/lib/hooks/useSettings';
import { usePlatform } from '@/platform/PlatformContext';
import { useServerStore } from '@/stores/serverStore';

/**
 * The folder new generated audio is saved to, and actions to change it.
 * Shared by Settings → Generation and the Gallery's quick folder control.
 */
export function useOutputFolder() {
  const { t } = useTranslation();
  const platform = usePlatform();
  const serverUrl = useServerStore((state) => state.serverUrl);
  const { settings, update } = useGenerationSettings();
  const [fallbackPath, setFallbackPath] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  // Path being typed when there is no native folder picker (web build).
  const [typingFolder, setTypingFolder] = useState<string | null>(null);

  // Servers that predate the output-folder setting only report the path here.
  useEffect(() => {
    if (settings?.effective_output_dir) return;
    fetch(`${serverUrl}/health/filesystem`)
      .then((res) => res.json())
      .then((data) => {
        const genDir = data.directories?.find((d: { path: string }) =>
          d.path.includes('generations'),
        );
        if (genDir?.path) setFallbackPath(genDir.path);
      })
      .catch(() => {});
  }, [serverUrl, settings?.effective_output_dir]);

  const outputFolder = settings?.effective_output_dir ?? fallbackPath;
  const hasCustomFolder = !!settings?.output_dir;

  /** Save *folder* as the output folder; "" restores the default. */
  const save = useCallback(
    (folder: string) =>
      update(
        { output_dir: folder },
        {
          onSuccess: () => {
            setTypingFolder(null);
            toast({
              title: folder
                ? t('settings.generation.folder.changed')
                : t('settings.generation.folder.resetDone'),
              description: t('settings.generation.folder.existingStay'),
            });
          },
          onError: (e) =>
            toast({
              title: t('settings.generation.folder.changeFailed'),
              description: e instanceof Error ? e.message : String(e),
              variant: 'destructive',
            }),
        },
      ),
    [update, t],
  );

  const choose = useCallback(async () => {
    const picked = await platform.filesystem.pickDirectory(
      t('settings.generation.folder.pickTitle'),
    );
    if (picked) save(picked);
    // No native folder picker in the web build: type the path instead.
    else if (!platform.metadata.isTauri) setTypingFolder(outputFolder ?? '');
  }, [platform, save, t, outputFolder]);

  const open = useCallback(async () => {
    if (!outputFolder) return;
    setOpening(true);
    try {
      await platform.filesystem.openPath(outputFolder);
    } catch (e) {
      console.error('Failed to open output folder:', e);
    } finally {
      setOpening(false);
    }
  }, [platform, outputFolder]);

  return {
    ready: !!settings,
    outputFolder,
    hasCustomFolder,
    typingFolder,
    setTypingFolder,
    save,
    choose,
    open,
    opening,
  };
}

export type OutputFolder = ReturnType<typeof useOutputFolder>;
