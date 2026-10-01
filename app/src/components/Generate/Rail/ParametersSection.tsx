import { Check, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Knob } from '@/components/ui/knob';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HelpHint, RailAction, RailSection } from '@/components/ui/rail-section';
import { useToast } from '@/components/ui/use-toast';
import type { EngineParameter } from '@/lib/api/types';
import { useGenerationPresets } from '@/lib/hooks/useGenerationPresets';
import { useSession } from '../useGenerateSession';
import { DEFAULT_SPEED, useRailSettings } from './useRailSettings';
import { DecoderControl } from './DecoderControl';

function formatParam(param: EngineParameter, value: number) {
  return param.unit === 'x' ? `${value.toFixed(2)}x` : `${value}${param.unit}`;
}

/** One knob; keeps a local draft while dragging and saves on release. */
function ParamKnob({
  param,
  value,
  onCommit,
  note,
}: {
  param: EngineParameter;
  value: number;
  onCommit: (v: number) => void;
  note?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="flex w-20 flex-col items-center gap-1.5">
      <Knob
        value={draft}
        min={param.min}
        max={param.max}
        step={param.step}
        defaultValue={param.default}
        label={param.label}
        onChange={setDraft}
        onCommit={onCommit}
      />
      <div className="flex items-center gap-1 text-xs font-semibold">
        {param.label}
        <HelpHint>
          {param.help}
          {note && <span className="mt-1 block text-muted-foreground">{note}</span>}
        </HelpHint>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatParam(param, draft)}
      </span>
    </div>
  );
}

export function ParametersSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { engine } = useSession();
  const rail = useRailSettings();
  const { presets, create, remove } = useGenerationPresets();
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  const params = engine?.parameters ?? [];
  const values: Record<string, number> = { speed: rail.speed };

  const current = JSON.stringify(rail.snapshot());
  const activePresetId = presets.find((p) => JSON.stringify(p.settings) === current)?.id;

  async function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    try {
      await create.mutateAsync({ name, settings: rail.snapshot() });
      setSaveOpen(false);
      setPresetName('');
      toast({ title: t('generate.params.presetSaved', { name }) });
    } catch (e) {
      toast({
        title: t('generate.params.presetSaveFailed'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }

  return (
    <RailSection
      icon={SlidersHorizontal}
      title={t('generate.params.title')}
      actions={
        <div className="relative flex items-center gap-1">
          <Popover open={saveOpen} onOpenChange={setSaveOpen}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <RailAction icon={Save}>{t('generate.params.presets')}</RailAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs">
                  {t('generate.params.presetsHint')}
                </DropdownMenuLabel>
                {presets.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => rail.applyPreset(p.settings)}
                    className="group"
                  >
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.id === activePresetId && <Check className="h-3.5 w-3.5 text-accent" />}
                    {!p.is_builtin && (
                      <button
                        type="button"
                        aria-label={t('generate.params.deletePreset', { name: p.name })}
                        className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          remove.mutate(p.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
                  <Save className="mr-2 h-3.5 w-3.5" />
                  {t('generate.params.saveCurrent')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Anchor for the "save preset" popover, opened from the menu. */}
            <PopoverTrigger asChild>
              <span
                className="pointer-events-none absolute right-0 top-full h-0 w-0"
                aria-hidden="true"
              />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-2 p-3">
              <p className="text-xs font-medium">{t('generate.params.saveCurrent')}</p>
              <Input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void savePreset()}
                placeholder={t('generate.params.presetName')}
                className="h-8"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 w-full"
                disabled={!presetName.trim() || create.isPending}
                onClick={() => void savePreset()}
              >
                {t('common.save')}
              </Button>
            </PopoverContent>
          </Popover>
          <RailAction onClick={() => rail.setSpeed(DEFAULT_SPEED)}>
            {t('generate.reset')}
          </RailAction>
        </div>
      }
    >
      <div className="flex flex-wrap gap-4">
        {params.map((param) => (
          <ParamKnob
            key={param.key}
            param={param}
            value={values[param.key] ?? param.default}
            onCommit={(v) => {
              if (param.key === 'speed') rail.setSpeed(v);
            }}
            note={
              param.key === 'speed' && engine && !engine.native_speed
                ? t('generate.params.speedStretchNote', { engine: engine.display_name })
                : undefined
            }
          />
        ))}
      </div>
      {engine?.engine === 'qwen_custom_voice' && (
        <div className="mt-4 border-t border-border/50 pt-4">
          <DecoderControl />
        </div>
      )}
    </RailSection>
  );
}
