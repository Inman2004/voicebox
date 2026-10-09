import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EngineId } from '@/lib/api/types';
import type { LanguageCode } from '@/lib/constants/languages';

/**
 * Selections made in the Generate rail that are per-device UI choices
 * (engine, size, output language, effects preset, pins, recents).
 *
 * Speed and text/audio processing are *server* defaults — they live in
 * ``useGenerationSettings`` so API/MCP callers get the same behaviour.
 */
interface GenerationOptionsStore {
  engine: EngineId;
  /** Chosen model size per engine (only meaningful for multi-size engines). */
  modelSizes: Partial<Record<EngineId, string>>;
  language: LanguageCode;
  /** Effects preset id, '_profile' for the voice's own chain, or null. */
  effectsPresetId: string | null;
  pinnedEngines: EngineId[];
  /** Most-recently used voice keys, newest first. */
  recentVoiceKeys: string[];
  /** Selected Voice Library key per engine. */
  voiceByEngine: Partial<Record<EngineId, string>>;

  setEngine: (engine: EngineId) => void;
  setModelSize: (engine: EngineId, size: string) => void;
  setLanguage: (language: LanguageCode) => void;
  setEffectsPresetId: (id: string | null) => void;
  togglePinnedEngine: (engine: EngineId) => void;
  pushRecentVoice: (key: string) => void;
  setVoiceForEngine: (engine: EngineId, key: string) => void;
}

const MAX_RECENTS = 12;

export const useGenerationOptionsStore = create<GenerationOptionsStore>()(
  persist(
    (set) => ({
      engine: 'kokoro',
      modelSizes: {},
      language: 'en',
      effectsPresetId: null,
      pinnedEngines: [],
      recentVoiceKeys: [],
      voiceByEngine: {},

      setEngine: (engine) => set({ engine }),
      setModelSize: (engine, size) =>
        set((s) => ({ modelSizes: { ...s.modelSizes, [engine]: size } })),
      setLanguage: (language) => set({ language }),
      setEffectsPresetId: (effectsPresetId) => set({ effectsPresetId }),
      togglePinnedEngine: (engine) =>
        set((s) => ({
          pinnedEngines: s.pinnedEngines.includes(engine)
            ? s.pinnedEngines.filter((e) => e !== engine)
            : [...s.pinnedEngines, engine],
        })),
      pushRecentVoice: (key) =>
        set((s) => ({
          recentVoiceKeys: [key, ...s.recentVoiceKeys.filter((k) => k !== key)].slice(0, MAX_RECENTS),
        })),
      setVoiceForEngine: (engine, key) =>
        set((s) => ({ voiceByEngine: { ...s.voiceByEngine, [engine]: key } })),
    }),
    { name: 'voicebox-generation-options' },
  ),
);
