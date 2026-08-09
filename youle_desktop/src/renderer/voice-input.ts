export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_STREAM_CHUNK_MS = 200;

const PROCESSOR_BUFFER_SIZE = 2048;

export type VoiceRecording = {
  durationMs: number;
  sampleRate: number;
  sampleCount: number;
};

export type VoiceRecorderOptions = {
  chunkDurationMs?: number;
  onAudioChunk?: (audioBytes: ArrayBuffer) => void;
};

export type VoiceRecorder = {
  getSampleCount(): number;
  stop(): Promise<VoiceRecording>;
  cancel(): void;
};

export async function createVoiceRecorder(options: VoiceRecorderOptions = {}): Promise<VoiceRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前系统不支持麦克风录音");
  }
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) {
    throw new Error("当前系统无法处理麦克风录音");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silentGain: GainNode | null = null;
  try {
    audioContext = new AudioContextConstructor({ sampleRate: VOICE_SAMPLE_RATE });
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    await audioContext.resume();
  } catch (error) {
    stopMediaStream(stream);
    await audioContext?.close().catch(() => {});
    throw error;
  }

  const streamChunkSamples = Math.max(
    1,
    Math.round((normalizeChunkDuration(options.chunkDurationMs) / 1000) * VOICE_SAMPLE_RATE),
  );
  const pendingChunks: Int16Array[] = [];
  const resampler = createStreamingPcm16Resampler(audioContext.sampleRate, VOICE_SAMPLE_RATE);
  let pendingSampleCount = 0;
  let sampleCount = 0;
  let stopPromise: Promise<VoiceRecording> | null = null;
  let cleanupPromise: Promise<void> | null = null;
  let cancelled = false;

  const emitAvailableChunks = (flush = false) => {
    while (pendingSampleCount >= streamChunkSamples || (flush && pendingSampleCount > 0)) {
      const count = flush ? Math.min(streamChunkSamples, pendingSampleCount) : streamChunkSamples;
      const pcm = consumePcmSamples(pendingChunks, count);
      pendingSampleCount -= pcm.length;
      try {
        options.onAudioChunk?.(pcm.buffer);
      } catch {}
    }
  };

  processor.onaudioprocess = (event) => {
    if (cancelled) return;
    const input = event.inputBuffer.getChannelData(0);
    const samples = resampler.push(input);
    if (!samples.length) return;
    pendingChunks.push(samples);
    pendingSampleCount += samples.length;
    sampleCount += samples.length;
    emitAvailableChunks();
  };

  const cleanupCapture = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      if (processor) processor.onaudioprocess = null;
      disconnectAudioNode(source);
      disconnectAudioNode(processor);
      disconnectAudioNode(silentGain);
      stopMediaStream(stream);
      if (audioContext?.state !== "closed") {
        await audioContext?.close().catch(() => {});
      }
      source = null;
      processor = null;
      silentGain = null;
      audioContext = null;
    })();
    return cleanupPromise;
  };

  return {
    getSampleCount() {
      return sampleCount;
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = cleanupCapture().then(() => {
        emitAvailableChunks(true);
        return {
          durationMs: Math.round((sampleCount / VOICE_SAMPLE_RATE) * 1000),
          sampleRate: VOICE_SAMPLE_RATE,
          sampleCount,
        };
      });
      return stopPromise;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      pendingChunks.length = 0;
      pendingSampleCount = 0;
      sampleCount = 0;
      void cleanupCapture();
    },
  };
}

function createStreamingPcm16Resampler(inputSampleRate: number, outputSampleRate: number) {
  const ratio = inputSampleRate / outputSampleRate;
  let sourceOffset = 0;
  let nextSourcePosition = 0;
  let previousSample = 0;
  let hasPreviousSample = false;

  return {
    push(input: Float32Array) {
      if (!input.length) return new Int16Array(0);
      if (Math.abs(ratio - 1) < 0.0001) {
        const output = new Int16Array(input.length);
        for (let index = 0; index < input.length; index += 1) output[index] = floatToPcm16(input[index]);
        sourceOffset += input.length;
        nextSourcePosition = sourceOffset;
        previousSample = input[input.length - 1] || 0;
        hasPreviousSample = true;
        return output;
      }

      const firstIndex = sourceOffset;
      const lastIndex = sourceOffset + input.length - 1;
      const output = new Int16Array(Math.ceil(input.length / ratio) + 2);
      let outputIndex = 0;
      const sampleAt = (absoluteIndex: number) => {
        if (absoluteIndex < firstIndex) return hasPreviousSample ? previousSample : input[0] || 0;
        return input[Math.min(input.length - 1, Math.max(0, absoluteIndex - firstIndex))] || 0;
      };

      while (nextSourcePosition <= lastIndex) {
        const leftIndex = Math.floor(nextSourcePosition);
        const rightIndex = Math.min(lastIndex, leftIndex + 1);
        const mix = nextSourcePosition - leftIndex;
        const sample = sampleAt(leftIndex) * (1 - mix) + sampleAt(rightIndex) * mix;
        output[outputIndex] = floatToPcm16(sample);
        outputIndex += 1;
        nextSourcePosition += ratio;
      }
      sourceOffset += input.length;
      previousSample = input[input.length - 1] || 0;
      hasPreviousSample = true;
      return output.slice(0, outputIndex);
    },
  };
}

function consumePcmSamples(chunks: Int16Array[], count: number) {
  const output = new Int16Array(count);
  let offset = 0;
  while (offset < count && chunks.length) {
    const chunk = chunks[0];
    const take = Math.min(chunk.length, count - offset);
    output.set(chunk.subarray(0, take), offset);
    offset += take;
    if (take === chunk.length) chunks.shift();
    else chunks[0] = chunk.subarray(take);
  }
  return offset === count ? output : output.slice(0, offset);
}

function normalizeChunkDuration(value: number | undefined) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return VOICE_STREAM_CHUNK_MS;
  return Math.max(40, Math.min(1000, Math.round(duration)));
}

function floatToPcm16(value: number) {
  const clamped = Math.max(-1, Math.min(1, value || 0));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

function disconnectAudioNode(node: AudioNode | null) {
  try {
    node?.disconnect();
  } catch {}
}

function stopMediaStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}
