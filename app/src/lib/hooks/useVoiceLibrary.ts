import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { apiClient } from '@/lib/api/client';
import type { LibraryVoice } from '@/lib/api/types';

const voicesKey = (engine?: string) => ['libraryVoices', engine ?? 'all'] as const;

/** Built-in voices + the user's compatible profiles for an engine. */
export function useLibraryVoices(engine?: string) {
  return useQuery({
    queryKey: voicesKey(engine),
    queryFn: () => apiClient.listLibraryVoices(engine),
    enabled: !!engine,
    staleTime: 30_000,
  });
}

/** Returns the profile id to generate with, creating it for built-in voices. */
export function useActivateVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (voice: LibraryVoice): Promise<string> => {
      if (voice.profile_id) return voice.profile_id;
      if (!voice.engine || !voice.voice_id) throw new Error('Voice is missing engine metadata');
      const res = await apiClient.activateVoice(voice.engine, voice.voice_id);
      return res.profile_id;
    },
    onSuccess: (_profileId, voice) => {
      if (!voice.profile_id) {
        queryClient.invalidateQueries({ queryKey: ['libraryVoices'] });
        queryClient.invalidateQueries({ queryKey: ['profiles'] });
      }
    },
  });
}

export function useToggleVoiceFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (voice: LibraryVoice) => apiClient.setVoiceFavorite(voice.key, !voice.favorite),
    onMutate: async (voice) => {
      await queryClient.cancelQueries({ queryKey: ['libraryVoices'] });
      queryClient.setQueriesData<LibraryVoice[]>({ queryKey: ['libraryVoices'] }, (old) =>
        old?.map((v) => (v.key === voice.key ? { ...v, favorite: !voice.favorite } : v)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['libraryVoices'] }),
  });
}

// ── Preview playback ────────────────────────────────────────────────
// One shared <audio> so starting a sample stops whichever one was playing.
// Blob URLs are cached per voice so replays are instant.

type PreviewState = { key: string | null; status: 'idle' | 'loading' | 'playing'; error: string | null };

let state: PreviewState = { key: null, status: 'idle', error: null };
const listeners = new Set<() => void>();
const urlCache = new Map<string, string>();
let audio: HTMLAudioElement | null = null;
let requestSeq = 0;

function setState(next: Partial<PreviewState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener('ended', () => setState({ key: null, status: 'idle' }));
    audio.addEventListener('pause', () => {
      if (state.status === 'playing') setState({ key: null, status: 'idle' });
    });
  }
  return audio;
}

export function stopVoicePreview() {
  requestSeq++;
  audio?.pause();
  setState({ key: null, status: 'idle' });
}

async function playVoicePreview(voice: LibraryVoice) {
  const seq = ++requestSeq;
  const el = getAudio();
  el.pause();
  setState({ key: voice.key, status: 'loading', error: null });
  try {
    let url = urlCache.get(voice.key);
    if (!url) {
      const blob = await apiClient.getVoicePreview(voice);
      url = URL.createObjectURL(blob);
      urlCache.set(voice.key, url);
    }
    if (seq !== requestSeq) return; // superseded by another click
    el.src = url;
    await el.play();
    setState({ status: 'playing' });
  } catch (e) {
    if (seq !== requestSeq) return;
    setState({ key: null, status: 'idle', error: e instanceof Error ? e.message : 'Preview unavailable' });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Play/stop a voice sample; reports loading/playing for a given voice. */
export function useVoicePreview() {
  const snapshot = useSyncExternalStore(subscribe, () => state);

  const toggle = useCallback((voice: LibraryVoice) => {
    if (state.key === voice.key) stopVoicePreview();
    else void playVoicePreview(voice);
  }, []);

  return {
    toggle,
    stop: stopVoicePreview,
    activeKey: snapshot.key,
    status: snapshot.status,
    error: snapshot.error,
  };
}
