import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useImportProfile } from '@/lib/hooks/useProfiles';

/** "Import voice" button + confirm dialog for `.voicebox.zip` profile packages. */
export function ImportProfileButton({ onImported, ...buttonProps }: ButtonProps & { onImported?: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const importProfile = useImportProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const reset = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.voicebox.zip')) {
      toast({
        title: t('main.import.invalidTitle'),
        description: t('main.import.invalidDescription'),
        variant: 'destructive',
      });
      reset();
      return;
    }
    setSelectedFile(file);
  };

  const handleConfirm = () => {
    if (!selectedFile) return;
    importProfile.mutate(selectedFile, {
      onSuccess: () => {
        reset();
        onImported?.();
        toast({
          title: t('main.import.successTitle'),
          description: t('main.import.successDescription'),
        });
      },
      onError: (error) => {
        toast({
          title: t('main.import.failedTitle'),
          description: error.message,
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} {...buttonProps}>
        <Upload className="h-4 w-4" />
        {t('main.importVoice')}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".voicebox.zip"
        onChange={handleFileChange}
        className="hidden"
      />
      <Dialog open={!!selectedFile} onOpenChange={(open) => !open && reset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('main.import.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('main.import.dialogDescription', { name: selectedFile?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={reset}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleConfirm} disabled={importProfile.isPending || !selectedFile}>
              {importProfile.isPending ? t('main.import.importing') : t('main.import.action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
