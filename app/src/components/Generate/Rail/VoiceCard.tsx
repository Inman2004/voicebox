import { Check, Loader2, Play, Square, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flag } from '@/components/ui/flag';
import { SimpleTooltip } from '@/components/ui/tooltip';
import type { LibraryVoice } from '@/lib/api/types';
import { useToggleVoiceFavorite, useVoicePreview } from '@/lib/hooks/useVoiceLibrary';
import { cn } from '@/lib/utils/cn';
import { VoiceAvatar } from '../VoiceAvatar';

export function voiceSubtitle(voice: LibraryVoice, t: (k: string) => string) {
  const gender = voice.gender ? t(`generate.voice.gender.${voice.gender}`) : null;
  const accent = voice.accent ?? null;
  return [accent, gender].filter(Boolean).join(' · ');
}

export function voiceTags(voice: LibraryVoice, t: (k: string) => string): string[] {
  const tags: string[] = [];
  if (voice.age) tags.push(t(`generate.voice.age.${voice.age}`));
  tags.push(...voice.styles);
  if (voice.kind === 'profile' && voice.voice_type && voice.voice_type !== 'preset') {
    tags.unshift(t(`generate.voice.type.${voice.voice_type}`));
  }
  return tags;
}

/** Play/stop sample button shared by cards, chips and the detail row. */
export function PreviewButton({ voice, className }: { voice: LibraryVoice; className?: string }) {
  const { t } = useTranslation();
  const preview = useVoicePreview();
  const active = preview.activeKey === voice.key;
  const loading = active && preview.status === 'loading';
  const playing = active && preview.status === 'playing';

  if (!voice.has_preview) {
    return (
      <SimpleTooltip content={t('generate.voice.noPreview')}>
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground/40',
            className,
          )}
        >
          <Play className="h-3.5 w-3.5" />
        </span>
      </SimpleTooltip>
    );
  }

  return (
    <SimpleTooltip content={playing ? t('generate.voice.stopSample') : t('generate.voice.playSample')}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          preview.toggle(voice);
        }}
        aria-label={playing ? t('generate.voice.stopSample') : t('generate.voice.playSample')}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
          playing ? 'bg-accent text-accent-foreground' : 'bg-foreground/90 text-background hover:bg-foreground',
          className,
        )}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : playing ? (
          <Square className="h-3 w-3 fill-current" />
        ) : (
          <Play className="h-3.5 w-3.5 fill-current" />
        )}
      </button>
    </SimpleTooltip>
  );
}

export function FavoriteButton({ voice }: { voice: LibraryVoice }) {
  const { t } = useTranslation();
  const toggle = useToggleVoiceFavorite();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate(voice);
      }}
      aria-pressed={voice.favorite}
      aria-label={voice.favorite ? t('generate.voice.unfavorite') : t('generate.voice.favorite')}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted transition-colors hover:bg-muted/70',
        voice.favorite ? 'text-accent' : 'text-muted-foreground',
      )}
    >
      <Star className={cn('h-3.5 w-3.5', voice.favorite && 'fill-current')} />
    </button>
  );
}

interface VoiceCardProps {
  voice: LibraryVoice;
  selected: boolean;
  onSelect: (voice: LibraryVoice) => void;
}

export function VoiceCard({ voice, selected, onSelect }: VoiceCardProps) {
  const { t } = useTranslation();
  const tags = voiceTags(voice, t);
  return (
    // biome-ignore lint/a11y/useSemanticElements: card contains nested buttons
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(voice)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(voice);
        }
      }}
      className={cn(
        'relative flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-accent bg-accent/10' : 'border-border bg-card hover:bg-muted/40',
      )}
    >
      {selected && (
        <Check className="absolute left-2 top-2 h-3.5 w-3.5 text-accent" aria-hidden="true" />
      )}
      <VoiceAvatar name={voice.name} avatarUrl={voice.avatar_url} className="h-12 w-12" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{voice.name}</p>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <Flag locale={voice.locale ?? voice.language} />
          <span className="truncate">{voiceSubtitle(voice, t)}</span>
        </p>
        {tags.length > 0 && (
          <SimpleTooltip content={tags.join(' · ')}>
            <p className="mt-1 inline-block max-w-full truncate rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {tags.join(' · ')}
            </p>
          </SimpleTooltip>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <FavoriteButton voice={voice} />
        <PreviewButton voice={voice} />
      </div>
    </div>
  );
}
