import { useMutation } from '@tanstack/react-query';
import { AudioLines, Dices, FileText, Loader2, SlidersHorizontal, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ParalinguisticInput } from '@/components/Generation/ParalinguisticInput';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { EffectConfig, VoiceProfileResponse } from '@/lib/api/types';
import { useSubmitGeneration } from '@/lib/hooks/useSubmitGeneration';
import { useActivateVoice } from '@/lib/hooks/useVoiceLibrary';
import { cn } from '@/lib/utils/cn';
import { useEditorDraftStore } from '@/stores/editorDraftStore';
import { useGenerationOptionsStore } from '@/stores/generationOptionsStore';
import { useUIStore } from '@/stores/uiStore';
import { insertAt, PauseChips } from './PauseChips';
import { useRailSettings } from './Rail/useRailSettings';
import { useSession } from './useGenerateSession';

const MAX_CHARS = 50_000;

interface TextEditorProps {
  profile?: VoiceProfileResponse;
  effectPresets?: { id: string; effects_chain: EffectConfig[] }[];
  onGenerated: (generationId: string) => void;
}

export function TextEditor({ profile, effectPresets, onGenerated }: TextEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const session = useSession();
  const rail = useRailSettings();
  const { submit, isPending } = useSubmitGeneration();
  const activate = useActivateVoice();
  const pushRecentVoice = useGenerationOptionsStore((s) => s.pushRecentVoice);
  const effectsPresetId = useGenerationOptionsStore((s) => s.effectsPresetId);
  const setSelectedProfileId = useUIStore((s) => s.setSelectedProfileId);

  // Start from a draft handed over by the Gallery ("Reuse text"), if any.
  // Read in the initializer (StrictMode may run it twice), clear after mount.
  const [text, setText] = useState(() => useEditorDraftStore.getState().draftText ?? '');
  useEffect(() => {
    useEditorDraftStore.getState().setDraftText(null);
  }, []);
  const [personality, setPersonality] = useState(false);
  const [instructOpen, setInstructOpen] = useState(false);
  const [instruct, setInstruct] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { engine, selectedVoice } = session;
  const useTags = !!engine?.supports_tags;
  const hasPersonality = !!profile?.personality?.trim();
  const busy = isPending || activate.isPending;
  const canGenerate = !!text.trim() && !!selectedVoice && !busy && text.length <= MAX_CHARS;

  const compose = useMutation({
    mutationFn: () => apiClient.composeWithPersonality(profile?.id ?? ''),
    onSuccess: (res) => setText(res.text),
    onError: (err: Error) =>
      toast({
        title: t('generation.compose.failedTitle'),
        description: err.message || t('generation.compose.failedDescription'),
        variant: 'destructive',
      }),
  });

  function insertPause(tag: string) {
    const el = textareaRef.current;
    if (!el || useTags) {
      // Rich tag editor: append at the end.
      setText((prev) => insertAt(prev, tag, prev.length, prev.length).text);
      return;
    }
    const { text: next, caret } = insertAt(text, tag, el.selectionStart, el.selectionEnd);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function effectsChain(): EffectConfig[] | undefined {
    if (!effectsPresetId) return undefined;
    if (effectsPresetId === '_profile') return profile?.effects_chain ?? undefined;
    return effectPresets?.find((p) => p.id === effectsPresetId)?.effects_chain;
  }

  async function generate() {
    if (!canGenerate || !selectedVoice || !engine) return;
    let profileId: string;
    try {
      profileId = await activate.mutateAsync(selectedVoice);
    } catch (e) {
      toast({
        title: t('generate.editor.voiceFailed'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
      return;
    }
    setSelectedProfileId(profileId);
    pushRecentVoice(selectedVoice.key);

    const result = await submit({
      profileId,
      text,
      language: session.language,
      engine: engine.engine,
      modelSize: session.variant?.model_size,
      instruct: engine.supports_instruct ? instruct : undefined,
      personality: hasPersonality && personality,
      effectsChain: effectsChain(),
      // Send the rail values explicitly so an in-flight settings save can't race the job.
      speed: rail.speed,
      preprocessing: rail.preprocessing,
      postprocessing: rail.postprocessing,
    });
    if (result) onGenerated(result.id);
  }

  const placeholder = selectedVoice
    ? t('generate.editor.placeholder', { name: selectedVoice.name })
    : t('generation.placeholder.selectVoice');

  return (
    <div className="rounded-3xl border border-border bg-card/60 p-4">
      <div className="rounded-2xl bg-muted/30">
        {useTags ? (
          <ParalinguisticInput
            value={text}
            onChange={setText}
            placeholder={t('generation.placeholder.effectsHint')}
            className="min-h-[260px] w-full px-4 py-3 text-sm outline-none"
            style={{ maxHeight: '50vh', overflowY: 'auto' }}
          />
        ) : (
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void generate();
              }
            }}
            placeholder={placeholder}
            className="min-h-[260px] resize-y border-none bg-transparent px-4 py-3 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            style={{ maxHeight: '50vh' }}
          />
        )}
      </div>

      {instructOpen && engine?.supports_instruct && (
        <Textarea
          value={instruct}
          onChange={(e) => setInstruct(e.target.value)}
          placeholder={t('generation.instruct.placeholder')}
          maxLength={500}
          className="mt-3 min-h-[60px] resize-none rounded-2xl border-accent/20 text-sm"
        />
      )}

      <div className="mt-3 border-b border-border pb-3">
        <PauseChips onInsert={insertPause} disabled={!selectedVoice} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <FileText className="h-4 w-4" />
          {t('generate.editor.inputText')}
        </span>

        {hasPersonality && (
          <>
            <SimpleTooltip content={t('generation.compose.tooltip')}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={compose.isPending}
                onClick={() => compose.mutate()}
                aria-label={t('generation.compose.ariaLabel')}
              >
                {compose.isPending ? <Loader2 className="animate-spin" /> : <Dices />}
              </Button>
            </SimpleTooltip>
            <SimpleTooltip
              content={personality ? t('generation.persona.tooltipActive') : t('generation.persona.tooltipInactive')}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', personality && 'bg-accent text-accent-foreground')}
                aria-pressed={personality}
                onClick={() => setPersonality((p) => !p)}
                aria-label={
                  personality ? t('generation.persona.ariaLabelActive') : t('generation.persona.ariaLabelInactive')
                }
              >
                <Wand2 />
              </Button>
            </SimpleTooltip>
          </>
        )}
        {engine?.supports_instruct && (
          <SimpleTooltip content={t('generation.instruct.tooltip')}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8', instructOpen && 'bg-accent text-accent-foreground')}
              aria-pressed={instructOpen}
              onClick={() => setInstructOpen((o) => !o)}
              aria-label={instructOpen ? t('generation.instruct.hide') : t('generation.instruct.show')}
            >
              <SlidersHorizontal />
            </Button>
          </SimpleTooltip>
        )}

        <span
          className={cn(
            'ml-auto text-xs tabular-nums text-muted-foreground',
            text.length > MAX_CHARS && 'text-destructive',
          )}
        >
          {t('generate.editor.characters', {
            count: text.length,
            max: MAX_CHARS.toLocaleString(),
            formatted: text.length.toLocaleString(),
          })}
        </span>

        <SimpleTooltip content={t('generate.editor.shortcut')}>
          <Button type="button" onClick={() => void generate()} disabled={!canGenerate} className="gap-2 px-5">
            {busy ? <Loader2 className="animate-spin" /> : <AudioLines />}
            {busy ? t('generation.button.generating') : t('generation.button.generate')}
          </Button>
        </SimpleTooltip>
      </div>
    </div>
  );
}
