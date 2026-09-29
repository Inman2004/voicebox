import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { EffectConfig, EngineId, GenerationRequest, GenerationResponse } from '@/lib/api/types';
import type { LanguageCode } from '@/lib/constants/languages';
import { fetchEngines, hasModelSizes, resolveVariant } from '@/lib/hooks/useEngines';
import { useGeneration } from '@/lib/hooks/useGeneration';
import { useModelDownloadToast } from '@/lib/hooks/useModelDownloadToast';
import { useGenerationSettings } from '@/lib/hooks/useSettings';
import { useGenerationStore } from '@/stores/generationStore';

export interface SubmitGenerationInput {
  profileId: string | null;
  text: string;
  language: LanguageCode;
  engine: EngineId;
  modelSize?: string;
  seed?: number;
  instruct?: string;
  personality?: boolean;
  effectsChain?: EffectConfig[];
  /** Omit to let the server apply its saved defaults. */
  speed?: GenerationRequest['speed'];
  preprocessing?: GenerationRequest['preprocessing'];
  postprocessing?: GenerationRequest['postprocessing'];
}

/**
 * Shared submit path for every generate surface: validates the voice,
 * surfaces a download toast when the model isn't cached, posts the job and
 * registers it for SSE progress tracking.
 */
export function useSubmitGeneration() {
  const { toast } = useToast();
  const generation = useGeneration();
  const addPendingGeneration = useGenerationStore((state) => state.addPendingGeneration);
  const { settings: genSettings } = useGenerationSettings();
  const [download, setDownload] = useState<{ modelName: string; displayName: string } | null>(null);

  useModelDownloadToast({
    modelName: download?.modelName || '',
    displayName: download?.displayName || '',
    enabled: !!download,
  });

  async function submit(input: SubmitGenerationInput): Promise<GenerationResponse | null> {
    if (!input.profileId) {
      toast({
        title: 'No voice selected',
        description: 'Pick a voice before generating.',
        variant: 'destructive',
      });
      return null;
    }

    try {
      const engines = await fetchEngines();
      const engine = engines.find((e) => e.engine === input.engine);
      const variant = resolveVariant(engine, input.modelSize);

      if (variant) {
        try {
          const modelStatus = await apiClient.getModelStatus();
          const model = modelStatus.models.find((m) => m.model_name === variant.model_name);
          if (model && !model.downloaded) {
            setDownload({ modelName: variant.model_name, displayName: variant.display_name });
          }
        } catch (error) {
          console.error('Failed to check model status:', error);
        }
      }

      const result = await generation.mutateAsync({
        profile_id: input.profileId,
        text: input.text,
        language: input.language,
        seed: input.seed,
        model_size: hasModelSizes(engine)
          ? (variant?.model_size as GenerationRequest['model_size'])
          : undefined,
        engine: input.engine,
        // Only engines that honour instruct at model level get it.
        instruct: engine?.supports_instruct ? input.instruct || undefined : undefined,
        personality: input.personality || undefined,
        max_chunk_chars: genSettings?.max_chunk_chars ?? 800,
        crossfade_ms: genSettings?.crossfade_ms ?? 50,
        normalize: genSettings?.normalize_audio ?? true,
        effects_chain: input.effectsChain?.length ? input.effectsChain : undefined,
        speed: input.speed,
        preprocessing: input.preprocessing,
        postprocessing: input.postprocessing,
      });

      addPendingGeneration(result.id);
      return result;
    } catch (error) {
      toast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Failed to generate audio',
        variant: 'destructive',
      });
      return null;
    } finally {
      setDownload(null);
    }
  }

  return { submit, isPending: generation.isPending };
}
