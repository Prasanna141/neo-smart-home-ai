import { MusicTrack } from '../types';

class NeoSoundEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private micSilentGain: GainNode | null = null;
  private micStream: MediaStream | null = null;
  private micKeepAliveTimer: number | null = null;
  private shouldKeepMicOpen = false;
  private currentMicRms = 0;
  private lastChunkCallback: ((base64Pcm: string, chunkRms: number) => void) | null = null;
  private musicGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private isPlayingMusic = false;
  private isDucked = false;
  private targetVolume = 0.55;
  private musicInterval: number | null = null;
  private stepIndex = 0;
  private currentTrack: MusicTrack | null = null;
  private activeAudioElement: HTMLAudioElement | null = null;
  private webMusicAudioElement: HTMLAudioElement | null = null;
  private webMusicMediaSource: MediaElementAudioSourceNode | null = null;
  private activeVoiceBufferSource: AudioBufferSourceNode | null = null;
  private simulatedSpeechEnergy = 0;

  // Gemini Live 24kHz gapless playback queue
  private nextLivePlayTime = 0;
  private liveScheduledSources: Set<AudioBufferSourceNode> = new Set();
  private onLiveSpeakingStateChange: ((isSpeaking: boolean) => void) | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.82;

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.targetVolume;
      this.musicGain.connect(this.analyser);

      this.voiceGain = this.ctx.createGain();
      this.voiceGain.gain.value = 1.0;
      this.voiceGain.connect(this.analyser);

      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setLiveSpeakingCallback(cb: ((isSpeaking: boolean) => void) | null) {
    this.onLiveSpeakingStateChange = cb;
  }

  /**
   * Starts real-time 16kHz 16-bit mono PCM microphone streaming for Gemini Live API & Serverless VAD
   */
  public async startLiveMicStream(
    onPcm16kChunk: (base64Pcm: string, chunkRms: number) => void
  ): Promise<void> {
    this.cleanupMicNodesOnly();
    this.shouldKeepMicOpen = true;
    this.lastChunkCallback = onPcm16kChunk;
    const ctx = this.ensureContext();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (!this.shouldKeepMicOpen) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this.micStream = stream;

    // Auto-recover if OS or browser SpeechRecognition ever ends the audio track while mic is ON
    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
      track.onended = () => {
        if (this.shouldKeepMicOpen && this.lastChunkCallback) {
          setTimeout(() => {
            if (this.shouldKeepMicOpen && this.lastChunkCallback) {
              this.startLiveMicStream(this.lastChunkCallback).catch(() => {});
            }
          }, 250);
        }
      };
    });

    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 256;
    this.micAnalyser.smoothingTimeConstant = 0.65;

    this.micSource = ctx.createMediaStreamSource(stream);
    this.micSource.connect(this.micAnalyser);

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    this.micProcessor = processor;

    const inputSampleRate = ctx.sampleRate;
    const targetSampleRate = 16000;

    processor.onaudioprocess = (e) => {
      if (!this.shouldKeepMicOpen) return;
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const inputData = e.inputBuffer.getChannelData(0);
      let sumSq = 0;
      for (let i = 0; i < inputData.length; i++) {
        sumSq += inputData[i] * inputData[i];
      }
      const chunkRms = Math.sqrt(sumSq / Math.max(1, inputData.length));
      this.currentMicRms = chunkRms;

      let pcm16: Int16Array;

      if (inputSampleRate === targetSampleRate) {
        pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
      } else {
        const ratio = inputSampleRate / targetSampleRate;
        const outLength = Math.floor(inputData.length / ratio);
        pcm16 = new Int16Array(outLength);
        for (let i = 0; i < outLength; i++) {
          const idx = Math.floor(i * ratio);
          const s = Math.max(-1, Math.min(1, inputData[idx] || 0));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
      }

      const bytes = new Uint8Array(pcm16.buffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, i + chunkSize))
        );
      }
      onPcm16kChunk(window.btoa(binary), chunkRms);
    };

    // Keep reference on `this` with micro-gain so V8 GC & Blink audio thread never suspend the node!
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0.00001;
    this.micSilentGain = silentGain;

    this.micSource.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);

    if (this.micKeepAliveTimer !== null) {
      clearInterval(this.micKeepAliveTimer);
    }
    this.micKeepAliveTimer = window.setInterval(() => {
      if (!this.shouldKeepMicOpen) return;
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const tracks = this.micStream?.getAudioTracks() || [];
      const hasLiveTrack = tracks.some((t) => t.readyState === 'live');
      if (!hasLiveTrack && this.lastChunkCallback) {
        this.startLiveMicStream(this.lastChunkCallback).catch(() => {});
      } else {
        tracks.forEach((t) => {
          if (!t.enabled) t.enabled = true;
        });
      }
    }, 1500);
  }

  /**
   * Packages an array of base64 16kHz 16-bit mono PCM chunks into a base64 WAV file
   */
  public buildWavBase64FromPcm16kChunks(base64Chunks: string[]): string {
    const byteArrays: Uint8Array[] = [];
    let totalDataBytes = 0;
    for (const b64 of base64Chunks) {
      const bin = window.atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        arr[i] = bin.charCodeAt(i);
      }
      byteArrays.push(arr);
      totalDataBytes += arr.length;
    }

    const wavBuffer = new ArrayBuffer(44 + totalDataBytes);
    const view = new DataView(wavBuffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + totalDataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, 16000, true); // 16kHz
    view.setUint32(28, 16000 * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // 16-bit
    writeStr(36, 'data');
    view.setUint32(40, totalDataBytes, true);

    const outBytes = new Uint8Array(wavBuffer);
    let offset = 44;
    for (const arr of byteArrays) {
      outBytes.set(arr, offset);
      offset += arr.length;
    }

    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < outBytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(outBytes.subarray(i, i + chunkSize))
      );
    }
    return window.btoa(binary);
  }

  /**
   * Speaks Sinhala/English text via server TTS stream or Web Speech synthesis while animating the Harmonic Orb
   */
  public async speakFallbackText(text: string): Promise<void> {
    const clean = (text || '').replace(/[*#`_~]/g, '').trim();
    if (!clean) return;

    this.ensureContext();
    this.setDucking(true);
    this.simulatedSpeechEnergy = 0.75;
    if (this.onLiveSpeakingStateChange) {
      this.onLiveSpeakingStateChange(true);
    }

    const finishSpeaking = () => {
      this.simulatedSpeechEnergy = 0;
      this.setDucking(false);
      if (this.onLiveSpeakingStateChange) {
        this.onLiveSpeakingStateChange(false);
      }
    };

    const playTtsUrl = async (url: string) => {
      const audio = new Audio(url);
      this.activeAudioElement = audio;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = (e) => reject(e);
        audio.play().catch(reject);
      });
    };

    try {
      const encodedText = encodeURIComponent(clean.slice(0, 200));
      try {
        await playTtsUrl(`/api/neo/tts-proxy?text=${encodedText}`);
      } catch {
        await playTtsUrl(
          `/api/index?__path=neo%2Ftts-proxy&text=${encodedText}`
        );
      }
      finishSpeaking();
      return;
    } catch {
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(clean);
          utter.lang = 'si-LK';
          utter.rate = 1.0;
          await new Promise<void>((resolve) => {
            utter.onend = () => resolve();
            utter.onerror = () => resolve();
            window.speechSynthesis.speak(utter);
          });
        } catch {}
      }
      finishSpeaking();
    }
  }

  private cleanupMicNodesOnly() {
    if (this.micKeepAliveTimer !== null) {
      clearInterval(this.micKeepAliveTimer);
      this.micKeepAliveTimer = null;
    }
    if (this.micProcessor) {
      try {
        this.micProcessor.onaudioprocess = null;
        this.micProcessor.disconnect();
      } catch {}
      this.micProcessor = null;
    }
    if (this.micSilentGain) {
      try {
        this.micSilentGain.disconnect();
      } catch {}
      this.micSilentGain = null;
    }
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {}
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      this.micStream = null;
    }
    this.micAnalyser = null;
    this.currentMicRms = 0;
  }

  public stopLiveMicStream() {
    this.shouldKeepMicOpen = false;
    this.lastChunkCallback = null;
    this.cleanupMicNodesOnly();
  }

  /**
   * Enqueues a 24kHz 16-bit mono PCM audio chunk from Gemini Live for gapless real-time playback
   */
  public enqueueLivePcm24kChunk(base64Pcm: string) {
    try {
      const ctx = this.ensureContext();
      const binaryStr = window.atob(base64Pcm);
      const byteLength = binaryStr.length;
      const sampleCount = Math.floor(byteLength / 2);
      if (sampleCount <= 0) return;

      const bytes = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const audioBuffer = ctx.createBuffer(1, sampleCount, 24000);
      const channelData = audioBuffer.getChannelData(0);
      const view = new DataView(bytes.buffer, 0, sampleCount * 2);
      for (let i = 0; i < sampleCount; i++) {
        channelData[i] = view.getInt16(i * 2, true) / 32768;
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      if (this.voiceGain) {
        source.connect(this.voiceGain);
      } else {
        source.connect(ctx.destination);
      }

      const now = ctx.currentTime;
      if (this.nextLivePlayTime < now) {
        this.nextLivePlayTime = now + 0.015;
      }

      const wasEmpty = this.liveScheduledSources.size === 0;
      this.liveScheduledSources.add(source);
      if (wasEmpty) {
        this.setDucking(true);
        if (this.onLiveSpeakingStateChange) {
          this.onLiveSpeakingStateChange(true);
        }
      }

      source.onended = () => {
        this.liveScheduledSources.delete(source);
        if (this.liveScheduledSources.size === 0) {
          this.setDucking(false);
          if (this.onLiveSpeakingStateChange) {
            this.onLiveSpeakingStateChange(false);
          }
        }
      };

      source.start(this.nextLivePlayTime);
      this.nextLivePlayTime += audioBuffer.duration;
    } catch {}
  }

  public clearLiveAudioQueue() {
    for (const src of this.liveScheduledSources) {
      try {
        src.onended = null;
        src.stop();
      } catch {}
    }
    this.liveScheduledSources.clear();
    this.nextLivePlayTime = 0;
    this.setDucking(false);
    if (this.onLiveSpeakingStateChange) {
      this.onLiveSpeakingStateChange(false);
    }
  }

  public isLiveSpeaking(): boolean {
    return this.liveScheduledSources.size > 0;
  }

  public getMicRmsLevel(): number {
    if (!this.micAnalyser) return this.currentMicRms;
    const buf = new Uint8Array(this.micAnalyser.fftSize);
    this.micAnalyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const norm = (buf[i] - 128) / 128;
      sumSq += norm * norm;
    }
    return Math.max(this.currentMicRms, Math.sqrt(sumSq / buf.length));
  }

  public playWakeChime() {
    try {
      const ctx = this.ensureContext();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(783.99, now);
      osc1.frequency.exponentialRampToValueAtTime(1174.66, now + 0.22);

      osc2.frequency.setValueAtTime(392.0, now);
      osc2.frequency.exponentialRampToValueAtTime(587.33, now + 0.22);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

      osc1.connect(gain);
      osc2.connect(gain);
      if (this.voiceGain) {
        gain.connect(this.voiceGain);
      } else {
        gain.connect(ctx.destination);
      }

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.45);
      osc2.stop(now + 0.45);
    } catch {}
  }

  public playDeviceSwitchChime(isOn: boolean) {
    try {
      const ctx = this.ensureContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isOn ? 523.25 : 659.25, now);
      osc.frequency.exponentialRampToValueAtTime(isOn ? 783.99 : 440.0, now + 0.16);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } catch {}
  }

  public setDucking(ducked: boolean) {
    this.isDucked = ducked;
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const desired = ducked ? this.targetVolume * 0.15 : this.targetVolume;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(desired, now, 0.15);
    if (this.webMusicAudioElement) {
      this.webMusicAudioElement.volume = ducked ? 0.18 : 0.85;
    }
  }

  public setVolume(vol: number) {
    this.targetVolume = Math.max(0, Math.min(1, vol));
    if (this.ctx && this.musicGain) {
      const now = this.ctx.currentTime;
      const desired = this.isDucked ? this.targetVolume * 0.15 : this.targetVolume;
      this.musicGain.gain.setTargetAtTime(desired, now, 0.1);
    }
  }

  /**
   * Streams a real MP3/M4A song from the web (e.g. songhub.lk / music.lk / archive.org / iTunes)
   * through Web Audio API so the Harmonic Orb reacts to the music and ducks when Neo speaks.
   */
  public async playWebStream(
    streamUrl: string,
    onEnded?: () => void
  ): Promise<boolean> {
    try {
      const ctx = this.ensureContext();
      this.stopMusic();

      if (!this.webMusicAudioElement) {
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.preload = 'auto';
        this.webMusicAudioElement = audio;
        try {
          this.webMusicMediaSource = ctx.createMediaElementSource(audio);
          if (this.musicGain) {
            this.webMusicMediaSource.connect(this.musicGain);
          } else if (this.analyser) {
            this.webMusicMediaSource.connect(this.analyser);
          }
        } catch {}
      }

      const audioEl = this.webMusicAudioElement;
      audioEl.pause();
      audioEl.src = streamUrl;
      audioEl.volume = this.isDucked ? 0.18 : 0.85;
      this.isPlayingMusic = true;

      audioEl.onended = () => {
        this.isPlayingMusic = false;
        if (onEnded) onEnded();
      };

      await audioEl.play();
      return true;
    } catch (err) {
      console.warn('Web audio stream fallback error:', err);
      return false;
    }
  }

  public startMusic(track: MusicTrack) {
    const ctx = this.ensureContext();
    this.stopMusic();
    this.currentTrack = track;
    this.isPlayingMusic = true;
    this.stepIndex = 0;

    const beatMs = Math.round((60 / track.tempo) * 1000 * 0.5);

    const playNoteStep = () => {
      if (!this.isPlayingMusic || !this.currentTrack || !this.musicGain) return;
      const now = ctx.currentTime;
      const scale = this.currentTrack.scale;
      const pattern = [0, 2, 4, 5, 4, 2, 1, 3];
      const noteIdx = pattern[this.stepIndex % pattern.length];
      const freq = scale[noteIdx % scale.length];

      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();
      osc.type = this.currentTrack.genre.includes('Synth') ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);

      const duration = (beatMs / 1000) * 1.4;
      noteGain.gain.setValueAtTime(0.001, now);
      noteGain.gain.linearRampToValueAtTime(0.14, now + 0.04);
      noteGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(filter);
      filter.connect(noteGain);
      noteGain.connect(this.musicGain);

      osc.start(now);
      osc.stop(now + duration + 0.02);

      if (this.stepIndex % 4 === 0) {
        const bassOsc = ctx.createOscillator();
        const bassGain = ctx.createGain();
        bassOsc.type = 'sine';
        bassOsc.frequency.setValueAtTime(this.currentTrack.baseFreq * 0.5, now);

        const bassDur = (beatMs / 1000) * 3.8;
        bassGain.gain.setValueAtTime(0.001, now);
        bassGain.gain.linearRampToValueAtTime(0.18, now + 0.08);
        bassGain.gain.exponentialRampToValueAtTime(0.001, now + bassDur);

        bassOsc.connect(bassGain);
        bassGain.connect(this.musicGain);

        bassOsc.start(now);
        bassOsc.stop(now + bassDur + 0.05);
      }

      this.stepIndex++;
    };

    playNoteStep();
    this.musicInterval = window.setInterval(playNoteStep, beatMs);
  }

  public stopMusic() {
    this.isPlayingMusic = false;
    if (this.musicInterval !== null) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
    if (this.webMusicAudioElement) {
      try {
        this.webMusicAudioElement.pause();
        this.webMusicAudioElement.currentTime = 0;
      } catch {}
    }
  }

  public stopSpeaking() {
    this.clearLiveAudioQueue();
    if (this.activeVoiceBufferSource) {
      try {
        this.activeVoiceBufferSource.onended = null;
        this.activeVoiceBufferSource.stop();
      } catch {}
      this.activeVoiceBufferSource = null;
    }
    if (this.activeAudioElement) {
      try {
        this.activeAudioElement.pause();
      } catch {}
      this.activeAudioElement = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.simulatedSpeechEnergy = 0;
    this.setDucking(false);
  }

  public getFrequencyData(): Uint8Array {
    const bufferLength = this.analyser ? this.analyser.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);

    if (this.analyser) {
      this.analyser.getByteFrequencyData(dataArray);
    }

    if (this.micAnalyser) {
      const micBins = new Uint8Array(this.micAnalyser.frequencyBinCount);
      this.micAnalyser.getByteFrequencyData(micBins);
      for (let i = 0; i < Math.min(bufferLength, micBins.length); i++) {
        dataArray[i] = Math.max(dataArray[i], micBins[i]);
      }
    }

    if (this.simulatedSpeechEnergy > 0) {
      const now = performance.now() * 0.012;
      for (let i = 0; i < bufferLength; i++) {
        const wave =
          (Math.sin(now + i * 0.28) * 0.4 +
            Math.cos(now * 1.7 - i * 0.19) * 0.3 +
            0.5) *
          195 *
          this.simulatedSpeechEnergy;
        dataArray[i] = Math.min(255, Math.max(dataArray[i], Math.floor(wave)));
      }
    }

    return dataArray;
  }
}

export const soundEngine = new NeoSoundEngine();
