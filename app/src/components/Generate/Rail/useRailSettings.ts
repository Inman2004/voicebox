import type {
  GenerationPresetSettings,
  PostprocessingOptions,
  PreprocessingOptions,
} from '@/lib/api/types';
import { useGenerationSettings } from '@/lib/hooks/useSettings';

// Mirrors the backend schema defaults (models.PreprocessingOptions etc.).
export const DEFAULT_SPEED = 1.0;

export const DEFAULT_PREPROCESSING: PreprocessingOptions = {
  normalize_whitespace: true,
  smart_numbers: false,
  lowercase: false,
  fix_initials: true,
  remove_reference_numbers: true,
  sentence_pause_ms: 0,
  replacements: [],
};

export const DEFAULT_POSTPROCESSING: PostprocessingOptions = {
  remove_silence: false,
  loudness: 'broadcast',
  target_lufs: -16,
};

/**
 * The rail's speed / text / audio processing values. They're server-side
 * generation defaults, so what you set here also applies to the API/MCP.
 */
export function useRailSettings() {
  const { settings, update, isLoading } = useGenerationSettings();

  const speed = settings?.speed ?? DEFAULT_SPEED;
  const preprocessing = { ...DEFAULT_PREPROCESSING, ...settings?.preprocessing };
  const postprocessing = { ...DEFAULT_POSTPROCESSING, ...settings?.postprocessing };

  return {
    isLoading,
    speed,
    preprocessing,
    postprocessing,
    setSpeed: (value: number) => update({ speed: value }),
    patchPreprocessing: (patch: Partial<PreprocessingOptions>) =>
      update({ preprocessing: { ...preprocessing, ...patch } }),
    patchPostprocessing: (patch: Partial<PostprocessingOptions>) =>
      update({ postprocessing: { ...postprocessing, ...patch } }),
    resetPreprocessing: () => update({ preprocessing: DEFAULT_PREPROCESSING }),
    resetPostprocessing: () => update({ postprocessing: DEFAULT_POSTPROCESSING }),
    snapshot: (): GenerationPresetSettings => ({ speed, preprocessing, postprocessing }),
    applyPreset: (s: GenerationPresetSettings) =>
      update({
        speed: s.speed,
        preprocessing: { ...DEFAULT_PREPROCESSING, ...s.preprocessing },
        postprocessing: { ...DEFAULT_POSTPROCESSING, ...s.postprocessing },
      }),
  };
}
