import { create } from 'zustand';

export type AudioExportFormat = 'wav' | 'mp3' | 'm4a';

interface AudioExportState {
  format: AudioExportFormat;
  resolve: ((format: AudioExportFormat | null) => void) | null;
  choose: () => Promise<AudioExportFormat | null>;
  finish: (format: AudioExportFormat | null) => void;
}

export const useAudioExportStore = create<AudioExportState>((set, get) => ({
  format: 'wav',
  resolve: null,
  choose: () => {
    get().resolve?.(null);
    return new Promise((resolve) => set({ resolve }));
  },
  finish: (format) => {
    const resolve = get().resolve;
    set({ resolve: null, ...(format ? { format } : {}) });
    resolve?.(format);
  },
}));

export const chooseAudioExportFormat = () => useAudioExportStore.getState().choose();
