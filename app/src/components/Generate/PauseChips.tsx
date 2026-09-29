import { Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const PAUSE_PRESETS = ['<500ms>', '<1s>', '<2s>'] as const;

/** Insert *tag* into *text* at the selection, padding with spaces as needed. */
export function insertAt(text: string, tag: string, start: number, end: number) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  // Always leave a space after the tag so the next word doesn't touch it.
  const trail = /^\s/.test(after) ? '' : ' ';
  const inserted = `${lead}${tag}${trail}`;
  return { text: before + inserted + after, caret: before.length + inserted.length };
}

export function PauseChips({ onInsert, disabled }: { onInsert: (tag: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{t('generate.editor.insertPause')}</span>
      {PAUSE_PRESETS.map((tag) => (
        <button
          key={tag}
          type="button"
          disabled={disabled}
          // Keep focus (and the caret) in the editor.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(tag)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 font-mono font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent/10 disabled:opacity-50"
        >
          <Pause className="h-3 w-3" />
          {tag}
        </button>
      ))}
      <span className="text-[11px] text-muted-foreground/70">{t('generate.editor.pauseHint')}</span>
    </div>
  );
}
