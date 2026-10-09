# Ryan decoder verification, October 1, 2026

Hardware: RTX 3050 Laptop GPU, 4096 MiB. Runtime: torch 2.11.0+cu128,
qwen-tts 0.1.1, Transformers 4.57.3. Model: Qwen3-TTS 0.6B CustomVoice,
BF16, Ryan, English. Sampling defaults unchanged. Fixed seed 11.

The retired whole frame graph differed from stock audio codes at frame 0
in a bounded greedy test. Forcing math attention moved divergence to frame 6,
but did not establish parity. This is evidence that the optimization changes
numerical execution, not proof of a particular audible artifact's cause.

The corrected path retains stock talker generation. Only the fixed length
code predictor uses a CUDA graph. Its attention uses the live cache prefix,
not padded static capacity. It retains stock attention dispatch, head shapes
and sampling operations. No new temperature, style instruction, text truncation
or chunking change was introduced.

## Code comparison

For the same short sentence with up to 128 generated tokens:

| Run | Frames | Seconds | Matches stock codes exactly |
| --- | ---: | ---: | --- |
| Stock greedy | 94 | 29.674 | Reference |
| Corrected fast greedy, cold | 94 | 12.516 | Yes |
| Corrected fast greedy, warm | 94 | 11.855 | Yes |
| Stock sampled | 81 | 26.007 | Reference |
| Corrected fast sampled, cold | 81 | 11.210 | Yes |
| Corrected fast sampled, warm | 81 | 10.798 | Yes |
| Corrected fast after another seed | 81 | 10.533 | Yes |

## Complete audio comparison

The saved workshop paragraph was generated through the Qwen wrapper without
postprocessing or time stretching. Each output was valid, finite, 17.12 seconds.

| Run | Generation seconds | Waveform exactly equals stock |
| --- | ---: | --- |
| Stock | 91.541 | Reference |
| Corrected fast | 37.396 | Yes |
| Corrected fast repeat | 39.440 | Yes |

The WAV files are stored alongside this report. These are actual complete
waveform comparisons, not a speech recognition score or a claim of listening.
This demonstrates parity for these tested inputs and seeds. It does not prove
all inputs, models, precision modes or long stories have equivalent quality.

Regression tests: 20 decoder/settings tests and 26 runtime/processing tests
passed. Existing deprecation warnings remain.

The correction is less aggressive than the retired whole frame decoder.
In the complete paragraph comparison it remains approximately 2.4 times faster
than stock. It does not reproduce a particular historical take whose random
seed was not saved.

## Packaged application verification

The rebuilt CUDA executable was tested with an isolated application database
through `/generate/stream`, using Ryan, English, 0.6B, BF16, seed 11,
CUDA Only and Fast. Postprocessing and effects were disabled for comparison.

Loading took 22.134 seconds. Generation took 38.179 seconds and produced
17.12 seconds of audio. The decoded PCM16 response differed from the float32
reference by at most 0.000030503, within one PCM16 quantization step.
The maximum allocated CUDA memory was 2,705,070,080 bytes, and maximum
reserved memory was 3,026,190,336 bytes. Runtime diagnostics reported CUDA,
BF16, no failure, and strategy `stock_talker_graph_predictor`.

History grouping, Stories and generation settings endpoints responded normally.
Frontend type checking and focused lint passed. Browser checks confirmed
Standard and Fast selections persist, share the Settings control, and become
disabled with a clear explanation in CPU mode. Only Qwen CustomVoice displays
this control. Two decoder choices use segmented buttons; a larger supported
catalog uses a select menu. Larger catalogs were not exercised in the live app.

The corrected CUDA executable and rebuilt desktop application were installed.
SHA256 checks confirmed each installed file matches its tested build.
Backups are in `.codex/ryan-hotfix/voicebox-server-cuda.before-corrected-decoder.exe`
and `.codex/ryan-hotfix/voicebox.before-decoder-ui.exe`.
User audio, profiles, model files and database were not changed by deployment.
The isolated test server was stopped and the browser server URL restored.
