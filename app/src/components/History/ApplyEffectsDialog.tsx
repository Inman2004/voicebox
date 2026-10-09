import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EffectsChainEditor } from '@/components/Effects/EffectsChainEditor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { EffectConfig, HistoryResponse } from '@/lib/api/types';
import { usePlayerStore } from '@/stores/playerStore';

interface ApplyEffectsDialogProps {
  /** Generation to process; null closes the dialog. */
  generation: HistoryResponse | null;
  onClose: () => void;
}

/** Apply an effects chain to a generation, creating a new version. */
export function ApplyEffectsDialog({ generation, onClose }: ApplyEffectsDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentAudioId = usePlayerStore((s) => s.audioId);
  const setAudioWithAutoPlay = usePlayerStore((s) => s.setAudioWithAutoPlay);
  const [sourceVersionId, setSourceVersionId] = useState<string | null>(null);
  const [chain, setChain] = useState<EffectConfig[]>([]);
  const [applying, setApplying] = useState(false);

  const versions = generation?.versions ?? [];

  // Reset per generation; default to the clean (effect-free) version.
  useEffect(() => {
    if (!generation) return;
    const clean = (generation.versions ?? []).find((v) => !v.effects_chain || v.effects_chain.length === 0);
    setSourceVersionId(clean?.id ?? null);
    setChain([]);
  }, [generation]);

  async function apply() {
    if (!generation || chain.length === 0) return;
    setApplying(true);
    try {
      const newVersion = await apiClient.applyEffectsToGeneration(generation.id, {
        effects_chain: chain,
        source_version_id: sourceVersionId ?? undefined,
        set_as_default: true,
      });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      // If the player is on this generation, reload with the new version.
      if (currentAudioId === generation.id) {
        setAudioWithAutoPlay(
          apiClient.getVersionAudioUrl(newVersion.id),
          generation.id,
          generation.profile_id,
          generation.text.substring(0, 50),
        );
      }
      onClose();
      toast({ title: 'Effects applied', description: 'A new version has been created.' });
    } catch (error) {
      toast({
        title: 'Failed to apply effects',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={!!generation} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('history.effectsDialog.title')}</DialogTitle>
          <DialogDescription>{t('history.effectsDialog.body')}</DialogDescription>
        </DialogHeader>
        {versions.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t('history.effectsDialog.sourceLabel')}</p>
            <Select value={sourceVersionId ?? ''} onValueChange={(val) => setSourceVersionId(val || null)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={t('history.effectsDialog.sourcePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">
                    {v.label}
                    {v.effects_chain && v.effects_chain.length > 0 && (
                      <span className="ml-1.5 text-muted-foreground">
                        ({v.effects_chain.map((e) => e.type).join(' + ')})
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="max-h-80 overflow-y-auto py-2">
          <EffectsChainEditor value={chain} onChange={setChain} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void apply()} disabled={applying || chain.length === 0}>
            {applying ? t('history.effectsDialog.applying') : t('history.effectsDialog.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
