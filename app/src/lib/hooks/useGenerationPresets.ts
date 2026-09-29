import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { GenerationPresetSettings } from '@/lib/api/types';

const KEY = ['generationPresets'] as const;

export function useGenerationPresets() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => apiClient.listGenerationPresets() });

  const create = useMutation({
    mutationFn: ({ name, settings }: { name: string; settings: GenerationPresetSettings }) =>
      apiClient.createGenerationPreset(name, settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.deleteGenerationPreset(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  return { presets: query.data ?? [], create, remove };
}
