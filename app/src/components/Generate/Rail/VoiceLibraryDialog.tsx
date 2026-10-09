import { Plus, Search, Star, Tag, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LibraryVoice } from '@/lib/api/types';
import { ALL_LANGUAGES, type LanguageCode } from '@/lib/constants/languages';
import { stopVoicePreview } from '@/lib/hooks/useVoiceLibrary';
import { cn } from '@/lib/utils/cn';
import { ImportProfileButton } from '@/components/VoiceProfiles/ImportProfileButton';
import { useUIStore } from '@/stores/uiStore';
import { VoiceCard, voiceTags } from './VoiceCard';

type GenderFilter = 'all' | 'male' | 'female';

interface VoiceLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voices: LibraryVoice[];
  selectedKey?: string;
  onSelect: (voice: LibraryVoice) => void;
  engineName?: string;
  /** Re-fetch so newly created profiles show up. */
  onRefresh?: () => void;
}

export function VoiceLibraryDialog({
  open,
  onOpenChange,
  voices,
  selectedKey,
  onSelect,
  engineName,
  onRefresh,
}: VoiceLibraryDialogProps) {
  const { t } = useTranslation();
  const setProfileDialogOpen = useUIStore((s) => s.setProfileDialogOpen);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState<string>('all');
  const [gender, setGender] = useState<GenderFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [tag, setTag] = useState<string>('all');

  useEffect(() => {
    if (open) onRefresh?.();
    else stopVoicePreview();
  }, [open, onRefresh]);

  const languages = useMemo(
    () => [...new Set(voices.map((v) => v.language))].sort(),
    [voices],
  );
  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const v of voices) for (const tg of voiceTags(v, t)) all.add(tg);
    return [...all].sort();
  }, [voices, t]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return voices.filter((v) => {
      if (language !== 'all' && v.language !== language) return false;
      if (gender !== 'all' && v.gender !== gender) return false;
      if (favoritesOnly && !v.favorite) return false;
      if (tag !== 'all' && !voiceTags(v, t).includes(tag)) return false;
      if (!q) return true;
      return [v.name, v.accent, v.description, ...v.styles]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }, [voices, search, language, gender, favoritesOnly, tag, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 pt-6 pb-4 text-left">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Volume2 className="h-5 w-5" />
                {t('generate.voice.libraryTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('generate.voice.available', { count: voices.length, engine: engineName ?? '' })}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 gap-2">
              <ImportProfileButton size="sm" onImported={onRefresh} />
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  setProfileDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                {t('generate.voice.createVoice')}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('generate.voice.search')}
              className="h-9 rounded-full pl-9"
            />
          </div>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="h-9 w-[170px] rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('generate.voice.allLanguages')}</SelectItem>
              {languages.map((l) => (
                <SelectItem key={l} value={l}>
                  {ALL_LANGUAGES[l as LanguageCode] ?? l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Segmented
            size="sm"
            value={gender}
            onChange={setGender}
            aria-label={t('generate.voice.genderFilter')}
            options={[
              { value: 'all', label: t('generate.voice.all') },
              { value: 'male', label: t('generate.voice.gender.male') },
              { value: 'female', label: t('generate.voice.gender.female') },
            ]}
          />
          <button
            type="button"
            onClick={() => setFavoritesOnly((f) => !f)}
            aria-pressed={favoritesOnly}
            aria-label={t('generate.voice.favoritesOnly')}
            title={t('generate.voice.favoritesOnly')}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
              favoritesOnly ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <Star className={cn('h-4 w-4', favoritesOnly && 'fill-current')} />
          </button>
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger className="h-9 w-[160px] rounded-full">
              <div className="flex items-center gap-2">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('generate.voice.allTags')}</SelectItem>
              {tags.map((tg) => (
                <SelectItem key={tg} value={tg}>
                  {tg}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t('generate.voice.noMatches')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((voice) => (
                <VoiceCard
                  key={voice.key}
                  voice={voice}
                  selected={voice.key === selectedKey}
                  onSelect={(v) => {
                    onSelect(v);
                    onOpenChange(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
