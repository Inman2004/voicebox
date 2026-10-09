import { Check, Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import { type AudioExportFormat, useAudioExportStore } from '@/stores/audioExportStore';

export function AudioExportDialog() {
  const { t } = useTranslation();
  const { resolve, format, finish } = useAudioExportStore();
  const [selected, setSelected] = useState<AudioExportFormat>(format);
  const formats: { value: AudioExportFormat; hint: string; detail: string }[] = [
    { value: 'wav', hint: t('audioExport.wavHint'), detail: t('audioExport.wavDetail') },
    { value: 'mp3', hint: t('audioExport.mp3Hint'), detail: '192 kbps' },
    { value: 'm4a', hint: t('audioExport.m4aHint'), detail: 'AAC · 192 kbps' },
  ];

  return (
    <Dialog
      open={!!resolve}
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogContent
        className="max-w-lg gap-5 rounded-2xl"
        onOpenAutoFocus={() => setSelected(format)}
      >
        <div className="flex items-start gap-3 pr-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
            <Download className="h-4 w-4" />
          </div>
          <div>
            <DialogTitle className="text-sm font-semibold">{t('audioExport.title')}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              {t('audioExport.description')}
            </DialogDescription>
          </div>
        </div>
        <fieldset className="grid grid-cols-3 gap-2" aria-label={t('audioExport.format')}>
          {formats.map(({ value, hint, detail }) => (
            <button
              key={value}
              type="button"
              aria-pressed={selected === value}
              onClick={() => setSelected(value)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected === value
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-muted/30 hover:bg-muted',
              )}
            >
              <span className="flex items-center justify-between text-sm font-semibold">
                {value.toUpperCase()}
                {selected === value && <Check className="h-4 w-4 text-accent" />}
              </span>
              <span className="mt-2 block text-xs text-muted-foreground">{hint}</span>
              <span className="mt-1 block text-[11px] text-muted-foreground">{detail}</span>
            </button>
          ))}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(null)}>
            {t('audioExport.cancel')}
          </Button>
          <Button className="gap-2" onClick={() => finish(selected)}>
            <Download className="h-4 w-4" />
            {t('audioExport.export', { format: selected.toUpperCase() })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
