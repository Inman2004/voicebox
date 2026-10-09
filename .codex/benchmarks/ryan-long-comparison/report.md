# Ryan, Standard and Fast, October 1, 2026

The installed CUDA backend generated the complete 2,410 character script
through the ordinary queued `/generate` workflow with an isolated database.
No application settings, user profiles or user recordings were changed.

Both modes used Qwen3-TTS 0.6B CustomVoice, Ryan, English, seed 11, BF16,
CUDA Only, speed 1.00, unchanged sampling defaults, an 800 character chunk
limit and a 50 millisecond crossfade. The four chunks contained 796, 791,
683 and 137 characters. Chunk seeds follow the existing application schedule.
Text preparation used the default cleanup flags. Silence removal and effects
were disabled. Broadcast loudness used a target of minus 16 LUFS.

| Measurement | Standard | Fast |
| --- | ---: | ---: |
| Model loading seconds | 17.37 | 0.00 (already loaded) |
| Generation seconds | 728.96 | 284.58 |
| Audio seconds | 162.33 | 162.33 |
| Generation seconds per audio second | 4.49 | 1.75 |
| Mean sampled GPU activity percent | 36.62 | 48.68 |
| Maximum sampled application RAM MiB | 2577.62 | 2299.30 |
| Observed neural execution | CUDA | CUDA |
| Actual decoder | Standard | Corrected CUDA graph predictor |

Fast generation was 2.56 times faster. Loading is excluded from this ratio.
These are single complete runs, not a repeated statistical benchmark.
Resource samples were taken approximately every four seconds. GPU activity
is device wide, RAM is for the backend process, and neither proves Windows
dedicated memory residency. CUDA peak counters are process wide and were not
reset between these two runs, so separate memory peaks are not claimed.

## Audio checks

Both exported WAV files contain 3,895,920 samples at 24,000 Hz.
The complete PCM16 waveforms match exactly, with maximum difference zero.
Both WAV files also have the identical SHA256:

`7b66796ff0734db04f6367b29be21381e733ab92bfdda625f099aa94079e64a2`

The files are valid and finite, with no samples at full scale.
Measured integrated loudness is minus 16.19 LUFS.
Measured sample peak is minus 1.00 dBFS.
The comparison includes all audio and all section joins.
Both runs completed without a reported runtime failure or CPU fallback.

This proves that the tested Fast output introduces no audible difference
from the tested Standard output, since the exported audio is identical.
It does not prove that the underlying Standard delivery has ideal pacing,
pronunciation or prosody. No subjective listening judgment is claimed.
The complete clips are provided for your listening check.

Files: `input.txt`, `standard.wav`, `fast.wav`, `standard.json`, `fast.json`,
and `comparison.json`. The JSON files include the requests, final diagnostics
and collected resource samples. The reproduction script is
`scripts/verify_ryan_long_audio.py` and expects an isolated server on port 17497.
