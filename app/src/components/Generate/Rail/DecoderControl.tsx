import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpHint } from '@/components/ui/rail-section';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useGenerationSettings } from '@/lib/hooks/useSettings';

interface DecoderChoice {
  value: string;
  label: string;
  description: string;
}

/** Two choices use compact buttons; larger validated catalogs use a select. */
export function DecoderSelector({
  value,
  options,
  label,
  disabled,
  onChange,
}: {
  value: string;
  options: DecoderChoice[];
  label: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (options.length <= 2) {
    return (
      <fieldset disabled={disabled} aria-label={label} className="min-w-0 disabled:opacity-60">
        <Segmented
          value={value}
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            title: option.description,
          }))}
          onChange={onChange}
          size="sm"
          className="w-full"
          aria-label={label}
        />
      </fieldset>
    );
  }
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 rounded-lg" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="block">{option.label}</span>
            <span className="block text-xs text-muted-foreground">{option.description}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DecoderControl() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const descriptionId = useId();
  const { settings, updateAsync, isUpdating } = useGenerationSettings();
  const execution = settings?.qwen_execution;
  const cpu = execution?.mode === 'cpu';
  const options: DecoderChoice[] = [
    {
      value: 'standard',
      label: t('inference.decoderStandard', 'Standard'),
      description: t(
        'inference.decoderStandardDescription',
        'Original Qwen decoder. Slower, with upstream execution unchanged.',
      ),
    },
    {
      value: 'fast',
      label: t('inference.decoderFast', 'Fast'),
      description: t(
        'inference.decoderFastDescription',
        'Stock talker with accelerated code prediction. Automatically uses Standard when unsupported.',
      ),
    },
  ];
  const value = cpu || execution?.fast_decode === false ? 'standard' : 'fast';
  async function change(next: string) {
    if (!execution || isUpdating || cpu) return;
    try {
      await updateAsync({ qwen_execution: { ...execution, fast_decode: next === 'fast' } });
    } catch (error) {
      toast({
        title: t('inference.decoderSaveFailed', 'Could not save decoder'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }
  return (
    <div className="space-y-2" aria-describedby={descriptionId} aria-busy={isUpdating}>
      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {t('inference.decoderLabel', 'Speech decoder')}
        <HelpHint>
          {t(
            'inference.decoderHelp',
            'Applies to the next generation. Running jobs keep their submitted decoder. Fast requires CUDA; CPU uses Standard.',
          )}
        </HelpHint>
      </div>
      <DecoderSelector
        value={value}
        options={options}
        label={t('inference.decoderLabel', 'Speech decoder')}
        disabled={!settings || isUpdating || cpu}
        onChange={(next) => void change(next)}
      />
      <p
        id={descriptionId}
        className="text-xs leading-relaxed text-muted-foreground"
        aria-live="polite"
      >
        {cpu
          ? t(
              'inference.decoderCpu',
              'CPU mode uses Standard. Choose Auto or CUDA Only in Settings to enable Fast.',
            )
          : options.find((option) => option.value === value)?.description}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {t(
          'inference.decoderNextJob',
          'Saved for the next generation; current jobs are unchanged.',
        )}
      </p>
    </div>
  );
}
