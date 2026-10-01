export function createAudioUrl(audioId: string, serverUrl: string): string {
  return `${serverUrl}/audio/${audioId}`;
}

export function downloadAudio(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function formatAudioDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get audio duration from a File.
 * If the file has a recordedDuration property (from recording hooks),
 * use that instead of trying to read metadata. This fixes issues on Windows
 * where WebM files from MediaRecorder don't have proper duration metadata.
 *
 * For uploaded files we use AudioContext.decodeAudioData which fully decodes
 * the audio and returns the exact duration. This is more reliable than
 * HTMLMediaElement.duration which can return incorrect large values for VBR
 * MP3 files that lack a proper XING/VBRI header.
 */
export async function getAudioDuration(
  file: File & { recordedDuration?: number },
): Promise<number> {
  if (file.recordedDuration !== undefined && Number.isFinite(file.recordedDuration)) {
    return file.recordedDuration;
  }

  // Use Web Audio API for accurate duration — avoids VBR MP3 metadata issues.
  try {
    const audioContext = new AudioContext();
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      return audioBuffer.duration;
    } finally {
      await audioContext.close();
    }
  } catch {
    // Fallback: read duration from the media element (less accurate but works for WAV).
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      const url = URL.createObjectURL(file);

      audio.addEventListener('loadedmetadata', () => {
        URL.revokeObjectURL(url);
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          resolve(audio.duration);
        } else {
          reject(new Error('Audio file has invalid duration metadata'));
        }
      });

      audio.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load audio file'));
      });

      audio.src = url;
    });
  }
}

/**
 * Convert any audio blob to WAV format using Web Audio API.
 * This ensures compatibility without requiring ffmpeg on the backend.
 */
export async function convertToWav(audioBlob: Blob): Promise<Blob> {
  // Create audio context
  const audioContext = new AudioContext();

  // Read blob as array buffer
  const arrayBuffer = await audioBlob.arrayBuffer();

  // Decode audio data
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Convert to WAV
  const wavBlob = audioBufferToWav(audioBuffer);

  // Close audio context to free resources
  await audioContext.close();

  return wavBlob;
}

/**
 * Convert AudioBuffer to WAV blob.
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;

  // Interleave channels
  const interleaved = interleaveChannels(buffer);

  // Create WAV file
  const dataLength = interleaved.length * bytesPerSample;
  const buffer2 = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer2);

  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true); // audio format (PCM)
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write audio data
  floatTo16BitPCM(view, 44, interleaved);

  return new Blob([buffer2], { type: 'audio/wav' });
}

/**
 * Interleave multiple channels into a single array.
 */
function interleaveChannels(buffer: AudioBuffer): Float32Array {
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const interleaved = new Float32Array(length * numberOfChannels);

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      interleaved[i * numberOfChannels + channel] = channelData[i];
    }
  }

  return interleaved;
}

/**
 * Write string to DataView.
 */
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Convert float32 audio data to 16-bit PCM.
 */
function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array): void {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

/** Waveform bars per channel handed to WaveSurfer (min and max of each bucket). */
const WAVEFORM_BUCKETS = 4000;
let peaksContext: OfflineAudioContext | null = null;

/**
 * Download audio and compute waveform peaks without creating a Blob.
 *
 * WaveSurfer's own loader turns every file into a Blob. Chromium caps the Blob
 * data a page may hold (spilling big blobs to disk, with a budget that shrinks
 * as the disk fills), so after a few long tracks `response.blob()` starts
 * failing with "Failed to fetch" even though the server answered 200.
 * Passing precomputed peaks makes WaveSurfer skip that path; its WebAudio
 * player then streams the URL into an ArrayBuffer (served from the HTTP cache).
 */
export async function loadWaveformPeaks(
  url: string,
  signal?: AbortSignal,
): Promise<{ peaks: Float32Array[]; duration: number }> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load audio: ${response.status} ${response.statusText}`);
  }
  const data = await response.arrayBuffer();
  // Offline context: decoding needs no audio device and one instance is reused.
  peaksContext ??= new OfflineAudioContext(1, 1, 44100);
  const buffer = await peaksContext.decodeAudioData(data);

  const peaks: Float32Array[] = [];
  for (let ch = 0; ch < Math.min(buffer.numberOfChannels, 2); ch++) {
    const samples = buffer.getChannelData(ch);
    const buckets = Math.min(WAVEFORM_BUCKETS, samples.length);
    const size = samples.length / buckets;
    const out = new Float32Array(buckets * 2);
    for (let b = 0; b < buckets; b++) {
      let min = 0;
      let max = 0;
      const end = Math.min(samples.length, Math.floor((b + 1) * size));
      for (let i = Math.floor(b * size); i < end; i++) {
        const v = samples[i];
        if (v > max) max = v;
        else if (v < min) min = v;
      }
      out[b * 2] = max;
      out[b * 2 + 1] = min;
    }
    peaks.push(out);
  }
  return { peaks, duration: buffer.duration };
}
