import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Volume2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag } from '@/components/ui/flag';
import { RailAction, RailSection } from '@/components/ui/rail-section';
import { cn } from '@/lib/utils/cn';
import { useGenerationOptionsStore } from '@/stores/generationOptionsStore';
import { rankVoices, useSession } from '../useGenerateSession';
import { VoiceAvatar } from '../VoiceAvatar';
import { PreviewButton, voiceSubtitle } from './VoiceCard';
import { VoiceLibraryDialog } from './VoiceLibraryDialog';

const CHIP_COUNT = 5;

export function VoiceSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { voices, voicesLoading, selectedVoice, selectVoice, engine } = useSession();
  const recents = useGenerationOptionsStore((s) => s.recentVoiceKeys);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const chips = useMemo(() => {
    const ranked = rankVoices(voices, recents);
    const top = ranked.slice(0, CHIP_COUNT);
    // Keep the selected voice visible even if it ranks lower.
    if (selectedVoice && !top.some((v) => v.key === selectedVoice.key)) {
      top[top.length - 1] = selectedVoice;
    }
    return top;
  }, [voices, recents, selectedVoice]);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['libraryVoices'] }),
    [queryClient],
  );

  const remaining = voices.length - chips.length;

  return (
    <RailSection
      icon={Volume2}
      title={t('generate.voice.title')}
      actions={
        <RailAction onClick={() => setLibraryOpen(true)} disabled={!voices.length}>
          {t('generate.voice.browseAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </RailAction>
      }
    >
      {voicesLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-muted/50" />
      ) : voices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          {engine?.supports_cloning
            ? t('generate.voice.emptyCloning', { engine: engine.display_name })
            : t('generate.voice.empty')}
          <button
            type="button"
            className="mt-2 block w-full text-accent hover:underline"
            onClick={() => setLibraryOpen(true)}
          >
            {t('generate.voice.createVoice')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {chips.map((voice) => {
              const active = voice.key === selectedVoice?.key;
              return (
                <button
                  key={voice.key}
                  type="button"
                  onClick={() => selectVoice(voice)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs font-medium transition-colors',
                    active
                      ? 'border-accent bg-accent/15 text-foreground'
                      : 'border-transparent bg-muted/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  <VoiceAvatar name={voice.name} avatarUrl={voice.avatar_url} className="h-6 w-6 ring-0" />
                  <span className="max-w-[90px] truncate">{voice.name}</span>
                </button>
              );
            })}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {t('generate.voice.more', { count: remaining })}
              </button>
            )}
          </div>

          {selectedVoice && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-muted/40 p-3">
              <VoiceAvatar name={selectedVoice.name} avatarUrl={selectedVoice.avatar_url} className="h-11 w-11" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{selectedVoice.name}</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <Flag locale={selectedVoice.locale ?? selectedVoice.language} />
                  <span className="truncate">{voiceSubtitle(selectedVoice, t)}</span>
                </p>
              </div>
              <PreviewButton voice={selectedVoice} />
            </div>
          )}
        </>
      )}

      <VoiceLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        voices={voices}
        selectedKey={selectedVoice?.key}
        onSelect={selectVoice}
        engineName={engine?.display_name}
        onRefresh={refresh}
      />
    </RailSection>
  );
}
