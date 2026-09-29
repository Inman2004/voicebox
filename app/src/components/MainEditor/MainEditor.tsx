import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { History, Images, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelSection } from '@/components/Generate/Rail/ModelSection';
import { ParametersSection } from '@/components/Generate/Rail/ParametersSection';
import { PostProcessingSection } from '@/components/Generate/Rail/PostProcessingSection';
import { TextPreprocessingSection } from '@/components/Generate/Rail/TextPreprocessingSection';
import { VoiceSection } from '@/components/Generate/Rail/VoiceSection';
import { ResultPanel } from '@/components/Generate/ResultPanel';
import { TextEditor } from '@/components/Generate/TextEditor';
import { GenerateSessionProvider, useSession } from '@/components/Generate/useGenerateSession';
import { HistoryTable } from '@/components/History/HistoryTable';
import { Button } from '@/components/ui/button';
import { ProfileForm } from '@/components/VoiceProfiles/ProfileForm';
import { apiClient } from '@/lib/api/client';
import { BOTTOM_SAFE_AREA_PADDING } from '@/lib/constants/ui';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { useProfile } from '@/lib/hooks/useProfiles';
import { cn } from '@/lib/utils/cn';
import { usePlayerStore } from '@/stores/playerStore';

export function MainEditor() {
  return (
    <GenerateSessionProvider>
      <GenerateScreen />
    </GenerateSessionProvider>
  );
}

function GenerateScreen() {
  const { t } = useTranslation();
  const isPlayerVisible = !!usePlayerStore((state) => state.audioUrl);
  const { selectedVoice } = useSession();
  const { data: profile } = useProfile(selectedVoice?.profile_id ?? '');
  const { data: effectPresets } = useQuery({
    queryKey: ['effectPresets'],
    queryFn: () => apiClient.listEffectPresets(),
  });
  const [lastGenerationId, setLastGenerationId] = useState<string | null>(null);
  // Wide windows always show the rail; narrower ones toggle it over the editor.
  const wide = useMediaQuery('(min-width: 1280px)');
  const [railToggled, setRailToggled] = useState(false);
  const railOpen = wide || railToggled;

  return (
    <div className="relative flex h-full min-h-0 gap-6 overflow-hidden pt-4">
      {/* Center: editor, live result, history */}
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto pb-6 pr-1',
          isPlayerVisible && BOTTOM_SAFE_AREA_PADDING,
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{t('generate.title')}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 xl:hidden"
            onClick={() => setRailToggled((o) => !o)}
            aria-label={railOpen ? t('generate.hideSettings') : t('generate.showSettings')}
          >
            {railOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>

        <TextEditor
          profile={profile}
          effectPresets={effectPresets}
          onGenerated={setLastGenerationId}
        />
        <ResultPanel generationId={lastGenerationId} />

        <section className="flex h-[65vh] min-h-[420px] shrink-0 flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <History className="h-4 w-4" />
              {t('generate.history')}
            </h3>
            <Link
              to="/gallery"
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Images className="h-3.5 w-3.5" />
              {t('generate.openGallery')}
            </Link>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <HistoryTable />
          </div>
        </section>
      </div>

      {/* Right: settings rail */}
      <aside
        className={cn(
          'w-[340px] shrink-0 flex-col gap-4 overflow-y-auto pb-6 pr-1',
          railOpen ? 'flex' : 'hidden',
          // Below xl the rail overlays the editor instead of squeezing it.
          !wide &&
            'absolute right-0 top-4 bottom-0 z-20 rounded-l-2xl bg-background/95 pl-3 shadow-2xl backdrop-blur',
          isPlayerVisible && BOTTOM_SAFE_AREA_PADDING,
        )}
        aria-label={t('generate.settings')}
      >
        {!wide && (
          <div className="sticky top-0 z-10 -mb-2 flex items-center justify-between bg-background/95 py-1">
            <span className="text-sm font-semibold">{t('generate.settings')}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setRailToggled(false)}
              aria-label={t('generate.hideSettings')}
            >
              <X />
            </Button>
          </div>
        )}
        <ModelSection />
        <VoiceSection />
        <ParametersSection />
        <PostProcessingSection hasProfileEffects={!!profile?.effects_chain?.length} />
        <TextPreprocessingSection />
      </aside>

      <ProfileForm />
    </div>
  );
}
