import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import type { EffectConfig } from '@/lib/api/types';
import { LANGUAGE_CODES, type LanguageCode } from '@/lib/constants/languages';
import { useSubmitGeneration } from '@/lib/hooks/useSubmitGeneration';
import { useUIStore } from '@/stores/uiStore';

const generationSchema = z.object({
  text: z.string().min(1, '').max(50000),
  language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]),
  seed: z.number().int().optional(),
  modelSize: z.enum(['1.7B', '0.6B', '1B', '3B']).optional(),
  instruct: z.string().max(500).optional(),
  engine: z
    .enum([
      'qwen',
      'qwen_custom_voice',
      'luxtts',
      'chatterbox',
      'chatterbox_turbo',
      'tada',
      'kokoro',
    ])
    .optional(),
  personality: z.boolean().optional(),
});

export type GenerationFormValues = z.infer<typeof generationSchema>;

interface UseGenerationFormOptions {
  onSuccess?: (generationId: string) => void;
  defaultValues?: Partial<GenerationFormValues>;
  getEffectsChain?: () => EffectConfig[] | undefined;
}

export function useGenerationForm(options: UseGenerationFormOptions = {}) {
  const { submit, isPending } = useSubmitGeneration();
  const selectedEngine = useUIStore((state) => state.selectedEngine);

  const form = useForm<GenerationFormValues>({
    resolver: zodResolver(generationSchema),
    defaultValues: {
      text: '',
      language: 'en',
      seed: undefined,
      modelSize: '1.7B',
      instruct: '',
      engine: (selectedEngine as GenerationFormValues['engine']) || 'qwen',
      personality: false,
      ...options.defaultValues,
    },
  });

  async function handleSubmit(
    data: GenerationFormValues,
    selectedProfileId: string | null,
  ): Promise<void> {
    const result = await submit({
      profileId: selectedProfileId,
      text: data.text,
      language: data.language,
      engine: data.engine || 'qwen',
      modelSize: data.modelSize,
      seed: data.seed,
      instruct: data.instruct,
      personality: data.personality,
      effectsChain: options.getEffectsChain?.(),
    });
    if (!result) return;

    // Reset form immediately — user can start typing again
    form.reset({
      text: '',
      language: data.language,
      seed: undefined,
      modelSize: data.modelSize,
      instruct: '',
      engine: data.engine,
      personality: data.personality,
    });
    options.onSuccess?.(result.id);
  }

  return {
    form,
    handleSubmit,
    isPending,
  };
}
