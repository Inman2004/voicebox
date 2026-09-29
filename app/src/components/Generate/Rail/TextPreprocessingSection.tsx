import { Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { HelpHint, OptionRow, RailAction, RailSection } from '@/components/ui/rail-section';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import type { PreprocessingOptions, WordReplacement } from '@/lib/api/types';
import { useRailSettings } from './useRailSettings';

/** "AI => A I" lines ⇄ replacement objects. */
export function parseReplacements(text: string): WordReplacement[] {
  return text
    .split('\n')
    .map((line) => line.split(/=>|→/))
    .filter((parts) => parts.length >= 2 && parts[0].trim())
    .map(([from, ...rest]) => ({ from: from.trim(), to: rest.join('=>').trim() }));
}

export function formatReplacements(list: WordReplacement[]): string {
  return list.map((r) => `${r.from} => ${r.to}`).join('\n');
}

type BoolKey = {
  [K in keyof PreprocessingOptions]: PreprocessingOptions[K] extends boolean ? K : never;
}[keyof PreprocessingOptions];

const TOGGLES: { key: BoolKey; label: string; help: string }[] = [
  { key: 'normalize_whitespace', label: 'normalizeWhitespace', help: 'normalizeWhitespaceHelp' },
  { key: 'smart_numbers', label: 'smartNumbers', help: 'smartNumbersHelp' },
  { key: 'lowercase', label: 'lowercase', help: 'lowercaseHelp' },
  { key: 'fix_initials', label: 'fixInitials', help: 'fixInitialsHelp' },
  { key: 'remove_reference_numbers', label: 'removeReferences', help: 'removeReferencesHelp' },
];

export function TextPreprocessingSection() {
  const { t } = useTranslation();
  const rail = useRailSettings();
  const pre = rail.preprocessing;

  // Replacements are edited as free text and saved after typing pauses.
  const [replacementText, setReplacementText] = useState(() => formatReplacements(pre.replacements));
  const savedRef = useRef(JSON.stringify(pre.replacements));
  const serverValue = JSON.stringify(pre.replacements);
  useEffect(() => {
    if (serverValue !== savedRef.current) {
      savedRef.current = serverValue;
      setReplacementText(formatReplacements(pre.replacements));
    }
  }, [serverValue, pre.replacements]);

  const patch = rail.patchPreprocessing;
  useEffect(() => {
    const parsed = parseReplacements(replacementText);
    const json = JSON.stringify(parsed);
    if (json === savedRef.current) return;
    const id = window.setTimeout(() => {
      savedRef.current = json;
      patch({ replacements: parsed });
    }, 600);
    return () => window.clearTimeout(id);
  }, [replacementText, patch]);

  const sentencePauses = pre.sentence_pause_ms > 0;
  const [pauseMs, setPauseMs] = useState(pre.sentence_pause_ms || 300);
  useEffect(() => {
    if (pre.sentence_pause_ms > 0) setPauseMs(pre.sentence_pause_ms);
  }, [pre.sentence_pause_ms]);

  return (
    <RailSection
      icon={Wand2}
      title={t('generate.pre.title')}
      actions={<RailAction onClick={rail.resetPreprocessing}>{t('generate.reset')}</RailAction>}
    >
      <div className="space-y-1">
        {TOGGLES.map(({ key, label, help }) => (
          <OptionRow
            key={key}
            htmlFor={`pre-${key}`}
            label={t(`generate.pre.${label}`)}
            help={t(`generate.pre.${help}`)}
            control={
              <Checkbox id={`pre-${key}`} checked={pre[key]} onCheckedChange={(v) => patch({ [key]: v })} />
            }
          />
        ))}
        <OptionRow
          htmlFor="pre-sentence-pauses"
          label={t('generate.pre.sentencePauses')}
          help={t('generate.pre.sentencePausesHelp')}
          control={
            <Checkbox
              id="pre-sentence-pauses"
              checked={sentencePauses}
              onCheckedChange={(v) => patch({ sentence_pause_ms: v ? pauseMs : 0 })}
            />
          }
        />
        {sentencePauses && (
          <div className="flex items-center gap-3 pl-6">
            <Slider
              min={100}
              max={2000}
              step={50}
              value={[pauseMs]}
              onValueChange={([v]) => setPauseMs(v)}
              onValueCommit={([v]) => patch({ sentence_pause_ms: v })}
              aria-label={t('generate.pre.sentencePauses')}
            />
            <span className="w-14 shrink-0 text-right text-xs tabular-nums">{pauseMs} ms</span>
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {t('generate.pre.replacements')}
          <HelpHint>{t('generate.pre.replacementsHelp')}</HelpHint>
        </div>
        <Textarea
          value={replacementText}
          onChange={(e) => setReplacementText(e.target.value)}
          placeholder={'AI => A I\nOpenVox => Open Vox'}
          spellCheck={false}
          className="min-h-[88px] resize-y rounded-lg bg-muted/30 font-mono text-xs"
        />
      </div>
    </RailSection>
  );
}
