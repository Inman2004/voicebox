import { create } from 'zustand';

/** Text handed to the Generate editor from elsewhere (e.g. Gallery → "Reuse text"). */
interface EditorDraftStore {
  draftText: string | null;
  setDraftText: (text: string | null) => void;
}

export const useEditorDraftStore = create<EditorDraftStore>((set) => ({
  draftText: null,
  setDraftText: (draftText) => set({ draftText }),
}));
