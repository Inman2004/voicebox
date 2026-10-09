import { createContext, createElement, type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import type { EngineId, LibraryVoice } from '@/lib/api/types';
import { ALL_LANGUAGES, type LanguageCode } from '@/lib/constants/languages';
import { type EngineWithStatus, resolveVariant, useEnginesWithStatus } from '@/lib/hooks/useEngines';
import { useLibraryVoices } from '@/lib/hooks/useVoiceLibrary';
import { useGenerationOptionsStore } from '@/stores/generationOptionsStore';
import { useUIStore } from '@/stores/uiStore';

/** Order voices for chips: favourites, then recents, then the rest. */
export function rankVoices(voices: LibraryVoice[], recents: string[]): LibraryVoice[] {
  const recentRank = new Map(recents.map((k, i) => [k, i]));
  return [...voices].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    const ra = recentRank.get(a.key) ?? Number.POSITIVE_INFINITY;
    const rb = recentRank.get(b.key) ?? Number.POSITIVE_INFINITY;
    return ra - rb;
  });
}

/**
 * Shared state for the Generate screen: engine, model size, output
 * language and the selected voice. Both the editor and the rail read it.
 */
export function useGenerateSession() {
  const engineId = useGenerationOptionsStore((s) => s.engine);
  const modelSizes = useGenerationOptionsStore((s) => s.modelSizes);
  const language = useGenerationOptionsStore((s) => s.language);
  const voiceByEngine = useGenerationOptionsStore((s) => s.voiceByEngine);
  const recentVoiceKeys = useGenerationOptionsStore((s) => s.recentVoiceKeys);
  const setLanguage = useGenerationOptionsStore((s) => s.setLanguage);
  const setVoiceForEngine = useGenerationOptionsStore((s) => s.setVoiceForEngine);
  const setSelectedEngine = useUIStore((s) => s.setSelectedEngine);
  const selectedProfileId = useUIStore((s) => s.selectedProfileId);
  const setSelectedProfileId = useUIStore((s) => s.setSelectedProfileId);

  const { data: engines, isLoading: enginesLoading } = useEnginesWithStatus();
  const engine: EngineWithStatus | undefined = engines?.find((e) => e.engine === engineId);
  const variant = resolveVariant(engine, modelSizes[engineId]);
  const variantStatus = variant ? engine?.variantStatus[variant.model_name] : undefined;

  const { data: voices, isLoading: voicesLoading } = useLibraryVoices(engineId);

  const selectedVoice = useMemo<LibraryVoice | undefined>(() => {
    if (!voices?.length) return undefined;
    const stored = voiceByEngine[engineId];
    const byStored = stored ? voices.find((v) => v.key === stored) : undefined;
    if (byStored) return byStored;
    // A profile picked elsewhere (e.g. Voices tab) wins over the ranking.
    const byProfile = selectedProfileId
      ? voices.find((v) => v.profile_id === selectedProfileId)
      : undefined;
    return byProfile ?? rankVoices(voices, recentVoiceKeys)[0];
  }, [voices, voiceByEngine, engineId, selectedProfileId, recentVoiceKeys]);

  // Variants can differ (TADA 1B is English-only, 3B is multilingual).
  const supportedLanguages: string[] = variant?.languages ?? engine?.languages ?? ['en'];
  const languageOptions = useMemo(
    () =>
      supportedLanguages.map((code) => ({
        value: code as LanguageCode,
        label: ALL_LANGUAGES[code as LanguageCode] ?? code,
      })),
    [supportedLanguages],
  );

  // Keep the rest of the app (e.g. the Stories box) in sync.
  useEffect(() => {
    setSelectedEngine(engineId);
  }, [engineId, setSelectedEngine]);

  // Output language must be one the engine supports.
  useEffect(() => {
    if (engine && !supportedLanguages.includes(language)) {
      setLanguage((supportedLanguages[0] as LanguageCode) ?? 'en');
    }
  }, [engine, supportedLanguages, language, setLanguage]);

  // A profile selected elsewhere (just created/imported, or picked in the
  // Voices tab) becomes the voice here once it shows up in the list.
  const lastProfileId = useRef(selectedProfileId);
  useEffect(() => {
    if (selectedProfileId === lastProfileId.current || !voices) return;
    const match = voices.find((v) => v.profile_id === selectedProfileId);
    if (match) {
      lastProfileId.current = selectedProfileId;
      if (match.key !== selectedVoice?.key) setVoiceForEngine(engineId, match.key);
    }
  }, [selectedProfileId, voices, selectedVoice?.key, engineId, setVoiceForEngine]);

  // Mirror an already-materialised voice into the global selection.
  useEffect(() => {
    if (selectedVoice?.profile_id && selectedVoice.profile_id !== selectedProfileId) {
      setSelectedProfileId(selectedVoice.profile_id);
    }
  }, [selectedVoice?.profile_id, selectedProfileId, setSelectedProfileId]);

  function selectVoice(voice: LibraryVoice) {
    setVoiceForEngine(engineId, voice.key);
    // Picking a voice in a language the engine supports switches the output language.
    const lang = voice.language as LanguageCode;
    if (supportedLanguages.includes(lang)) setLanguage(lang);
  }

  return {
    engines,
    enginesLoading,
    engineId: engineId as EngineId,
    engine,
    variant,
    variantStatus,
    language,
    setLanguage,
    languageOptions,
    voices: voices ?? [],
    voicesLoading,
    selectedVoice,
    selectVoice,
  };
}

export type GenerateSession = ReturnType<typeof useGenerateSession>;

const SessionContext = createContext<GenerateSession | null>(null);

export function GenerateSessionProvider({ children }: { children: ReactNode }) {
  const session = useGenerateSession();
  return createElement(SessionContext.Provider, { value: session }, children);
}

/** Read the Generate screen session (must be under GenerateSessionProvider). */
export function useSession(): GenerateSession {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside GenerateSessionProvider');
  return ctx;
}
