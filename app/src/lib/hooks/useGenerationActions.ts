import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { HistoryResponse } from '@/lib/api/types';
import { useExportGeneration, useExportGenerationAudio } from '@/lib/hooks/useHistory';
import { useEditorDraftStore } from '@/stores/editorDraftStore';
import { useGenerationStore } from '@/stores/generationStore';
import { usePlayerStore } from '@/stores/playerStore';

type Gen = Pick<HistoryResponse, 'id' | 'text' | 'profile_id'>;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Every per-generation action (play, favourite, export, retry, regenerate,
 * versions, cancel, reuse text). Shared by History and Gallery so both
 * behave identically.
 */
export function useGenerationActions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const addPendingGeneration = useGenerationStore((s) => s.addPendingGeneration);
  const setAudioWithAutoPlay = usePlayerStore((s) => s.setAudioWithAutoPlay);
  const restartCurrentAudio = usePlayerStore((s) => s.restartCurrentAudio);
  const currentAudioId = usePlayerStore((s) => s.audioId);
  const setDraftText = useEditorDraftStore((s) => s.setDraftText);
  const exportGeneration = useExportGeneration();
  const exportGenerationAudio = useExportGenerationAudio();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['history'] });

  const cancel = useMutation({
    mutationFn: (generationId: string) => apiClient.cancelGeneration(generationId),
    onSuccess: async (data) => {
      await refresh();
      toast({ title: 'Cancelling generation', description: data.message });
    },
    onError: (error) =>
      toast({
        title: 'Cancel failed',
        description: errorMessage(error, 'Could not cancel generation'),
        variant: 'destructive',
      }),
  });

  return {
    play(gen: Gen) {
      if (currentAudioId === gen.id) restartCurrentAudio();
      else setAudioWithAutoPlay(apiClient.getAudioUrl(gen.id), gen.id, gen.profile_id, gen.text.substring(0, 50));
    },

    playVersion(gen: Gen, versionId: string) {
      setAudioWithAutoPlay(apiClient.getVersionAudioUrl(versionId), gen.id, gen.profile_id, gen.text.substring(0, 50));
    },

    async setActiveVersion(generationId: string, versionId: string) {
      try {
        await apiClient.setDefaultVersion(generationId, versionId);
        await refresh();
      } catch (error) {
        toast({
          title: 'Failed to switch version',
          description: errorMessage(error, 'Unknown error'),
          variant: 'destructive',
        });
      }
    },

    downloadAudio(gen: Gen) {
      exportGenerationAudio.mutate(
        { generationId: gen.id, text: gen.text },
        {
          onError: (error) =>
            toast({ title: 'Failed to download audio', description: error.message, variant: 'destructive' }),
        },
      );
    },

    exportPackage(gen: Gen) {
      exportGeneration.mutate(
        { generationId: gen.id, text: gen.text },
        {
          onError: (error) =>
            toast({ title: 'Failed to export generation', description: error.message, variant: 'destructive' }),
        },
      );
    },

    async retry(generationId: string) {
      try {
        const result = await apiClient.retryGeneration(generationId);
        addPendingGeneration(result.id);
        await refresh();
      } catch (error) {
        toast({
          title: 'Retry failed',
          description: errorMessage(error, 'Could not retry generation'),
          variant: 'destructive',
        });
      }
    },

    async regenerate(generationId: string) {
      try {
        await apiClient.regenerateGeneration(generationId);
        addPendingGeneration(generationId);
        await refresh();
      } catch (error) {
        toast({
          title: 'Regenerate failed',
          description: errorMessage(error, 'Could not regenerate'),
          variant: 'destructive',
        });
      }
    },

    async toggleFavorite(generationId: string) {
      try {
        await apiClient.toggleFavorite(generationId);
        await refresh();
      } catch (error) {
        toast({
          title: 'Failed to update favorite',
          description: errorMessage(error, 'Unknown error'),
          variant: 'destructive',
        });
      }
    },

    async copyText(gen: Gen) {
      try {
        await navigator.clipboard.writeText(gen.text);
        toast({ title: 'Text copied' });
      } catch {
        toast({ title: 'Could not copy text', variant: 'destructive' });
      }
    },

    /** Open the text in the Generate editor. */
    reuseText(gen: Gen) {
      setDraftText(gen.text);
      navigate({ to: '/' });
    },

    cancel: cancel.mutate,
    cancellingId: cancel.isPending ? cancel.variables : undefined,
    isExportingAudio: exportGenerationAudio.isPending,
    isExportingPackage: exportGeneration.isPending,
    currentAudioId,
  };
}

export type GenerationActions = ReturnType<typeof useGenerationActions>;
