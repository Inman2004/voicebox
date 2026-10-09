import { useQuery } from '@tanstack/react-query';
import { Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { HelpHint, OptionRow, RailAction, RailSection } from '@/components/ui/rail-section';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { apiClient } from '@/lib/api/client';
import { useGenerationOptionsStore } from '@/stores/generationOptionsStore';
import { useRailSettings } from './useRailSettings';

export function PostProcessingSection({ hasProfileEffects }: { hasProfileEffects: boolean }) {
  const { t } = useTranslation();
  const rail = useRailSettings();
  const post = rail.postprocessing;
  const effectsPresetId = useGenerationOptionsStore((s) => s.effectsPresetId);
  const setEffectsPresetId = useGenerationOptionsStore((s) => s.setEffectsPresetId);
  const { data: effectPresets } = useQuery({
    queryKey: ['effectPresets'],
    queryFn: () => apiClient.listEffectPresets(),
  });

  const normalize = post.loudness !== 'off';
  const [lufs, setLufs] = useState(post.target_lufs);
  useEffect(() => setLufs(post.target_lufs), [post.target_lufs]);

  return (
    <RailSection
      icon={Wand2}
      title={t('generate.post.title')}
      actions={<RailAction onClick={rail.resetPostprocessing}>{t('generate.reset')}</RailAction>}
    >
      <div className="space-y-1">
        <OptionRow
          htmlFor="post-remove-silence"
          label={t('generate.post.removeSilence')}
          help={t('generate.post.removeSilenceHelp')}
          control={
            <Checkbox
              id="post-remove-silence"
              checked={post.remove_silence}
              onCheckedChange={(v) => rail.patchPostprocessing({ remove_silence: v })}
            />
          }
        />
        <OptionRow
          htmlFor="post-normalize"
          label={t('generate.post.normalize')}
          help={t('generate.post.normalizeHelp')}
          control={
            <Checkbox
              id="post-normalize"
              checked={normalize}
              onCheckedChange={(v) => rail.patchPostprocessing({ loudness: v ? 'broadcast' : 'off' })}
            />
          }
        />
      </div>

      {normalize && (
        <div className="mt-3 space-y-3 rounded-xl bg-muted/30 p-3">
          <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {t('generate.post.method')}
            <HelpHint>{t('generate.post.methodHelp')}</HelpHint>
          </div>
          <Segmented
            className="w-full"
            value={post.loudness === 'simple' ? 'simple' : 'broadcast'}
            onChange={(v) => rail.patchPostprocessing({ loudness: v })}
            options={[
              { value: 'broadcast', label: t('generate.post.broadcast') },
              { value: 'simple', label: t('generate.post.simple') },
            ]}
          />
          {post.loudness === 'broadcast' && (
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center gap-1 text-xs font-medium">
                {t('generate.post.targetLevel')}
                <HelpHint>{t('generate.post.targetLevelHelp')}</HelpHint>
              </div>
              <Slider
                min={-30}
                max={-10}
                step={1}
                value={[lufs]}
                onValueChange={([v]) => setLufs(v)}
                onValueCommit={([v]) => rail.patchPostprocessing({ target_lufs: v })}
                aria-label={t('generate.post.targetLevel')}
              />
              <span className="w-14 shrink-0 text-right text-xs tabular-nums">{lufs} LUFS</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 space-y-1.5">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {t('generate.post.effects')}
          <HelpHint>{t('generate.post.effectsHelp')}</HelpHint>
        </div>
        <Select
          value={effectsPresetId ?? 'none'}
          onValueChange={(v) => setEffectsPresetId(v === 'none' ? null : v)}
        >
          <SelectTrigger className="h-9 rounded-lg bg-muted/40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('generation.effects.none')}</SelectItem>
            {hasProfileEffects && (
              <SelectItem value="_profile">{t('generation.effects.profileDefault')}</SelectItem>
            )}
            {effectPresets?.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </RailSection>
  );
}
