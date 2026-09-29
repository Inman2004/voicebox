import { useEffect, useMemo } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { FormControl } from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EngineInfo, VoiceProfileResponse } from '@/lib/api/types';
import type { LanguageCode } from '@/lib/constants/languages';
import { useEngines } from '@/lib/hooks/useEngines';
import type { GenerationFormValues } from '@/lib/hooks/useGenerationForm';

interface EngineOption {
  /** "engine" or "engine:size" for multi-size engines */
  value: string;
  label: string;
  engine: EngineInfo;
  modelSize?: string;
}

/** One option per engine variant, from the backend engine registry. */
function buildOptions(engines: EngineInfo[]): EngineOption[] {
  return engines.flatMap((engine): EngineOption[] =>
    engine.variants.length > 1
      ? engine.variants.map((v) => ({
          value: `${engine.engine}:${v.model_size}`,
          label: v.display_name,
          engine,
          modelSize: v.model_size,
        }))
      : [{ value: engine.engine, label: engine.display_name, engine }],
  );
}

function getSelectValue(options: EngineOption[], engine: string, modelSize?: string): string {
  const exact = options.find((o) => o.engine.engine === engine && o.modelSize === modelSize);
  return (exact ?? options.find((o) => o.engine.engine === engine))?.value ?? engine;
}

export function applyEngineSelection(form: UseFormReturn<GenerationFormValues>, option: EngineOption) {
  form.setValue('engine', option.engine.engine as GenerationFormValues['engine']);
  form.setValue('modelSize', option.modelSize as GenerationFormValues['modelSize']);
  // Keep the language valid for the new engine/variant.
  const variant = option.engine.variants.find((v) => v.model_size === option.modelSize);
  const available = variant?.languages ?? option.engine.languages;
  const current = form.getValues('language');
  if (!available.includes(current)) {
    form.setValue('language', (available[0] as LanguageCode) ?? 'en');
  }
}

interface EngineModelSelectorProps {
  form: UseFormReturn<GenerationFormValues>;
  compact?: boolean;
  selectedProfile?: VoiceProfileResponse | null;
}

export function EngineModelSelector({ form, compact, selectedProfile }: EngineModelSelectorProps) {
  const { data: engines } = useEngines();
  const engine = form.watch('engine') || 'qwen';
  const modelSize = form.watch('modelSize');

  const availableOptions = useMemo(() => {
    const all = buildOptions(engines ?? []);
    return selectedProfile ? all.filter((o) => isProfileCompatibleWithEngine(selectedProfile, o.engine)) : all;
  }, [engines, selectedProfile]);

  const selectValue = getSelectValue(availableOptions, engine, modelSize);
  const currentEngineAvailable = availableOptions.some((opt) => opt.value === selectValue);

  useEffect(() => {
    if (!currentEngineAvailable && availableOptions.length > 0) {
      applyEngineSelection(form, availableOptions[0]);
    }
  }, [availableOptions, currentEngineAvailable, form]);

  const itemClass = compact ? 'text-xs text-muted-foreground' : undefined;
  const triggerClass = compact
    ? 'h-8 text-xs bg-card border-border rounded-full hover:bg-background/50 transition-all'
    : undefined;

  return (
    <Select
      value={selectValue}
      onValueChange={(v) => {
        const option = availableOptions.find((o) => o.value === v);
        if (option) applyEngineSelection(form, option);
      }}
    >
      <FormControl>
        <SelectTrigger className={triggerClass}>
          <SelectValue />
        </SelectTrigger>
      </FormControl>
      <SelectContent side={compact ? 'top' : undefined}>
        {availableOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className={itemClass}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Whether a profile can be voiced by *engine* (mirrors backend validate_profile_engine). */
export function isProfileCompatibleWithEngine(
  profile: VoiceProfileResponse,
  engine: Pick<EngineInfo, 'engine' | 'supports_cloning'>,
): boolean {
  const voiceType = profile.voice_type || 'cloned';
  if (voiceType === 'preset') return profile.preset_engine === engine.engine;
  if (voiceType === 'cloned') return engine.supports_cloning;
  return true; // designed
}
