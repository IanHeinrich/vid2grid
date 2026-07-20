/**
 * Decodes a video file's audio track into a mono 16 kHz PCM buffer suitable
 * for feeding straight into a Whisper ASR pipeline.
 *
 * Uses the browser's native audio decoder rather than any new demuxing code:
 * `decodeAudioData` resamples directly to whatever sample rate the
 * `AudioContext` it's called on was constructed with, so building the
 * context at Whisper's expected 16 kHz does the resample for free.
 */
const WHISPER_SAMPLE_RATE = 16000;

export async function decodeAudioForTranscription(
  file: File,
  startTime: number,
  endTime: number,
): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error("This video has no decodable audio track.");
  } finally {
    void audioCtx.close();
  }

  const mono = downmixToMono(audioBuffer);
  return sliceSamples(mono, audioBuffer.sampleRate, startTime, endTime);
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();

  const mixed = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mixed[i] += data[i] / buffer.numberOfChannels;
  }
  return mixed;
}

function sliceSamples(
  samples: Float32Array,
  sampleRate: number,
  startTime: number,
  endTime: number,
): Float32Array {
  const startIndex = Math.max(0, Math.floor(startTime * sampleRate));
  const endIndex = Math.min(samples.length, Math.ceil(endTime * sampleRate));
  return samples.slice(startIndex, endIndex);
}
