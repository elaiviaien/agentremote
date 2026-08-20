/**
 * ParaRaid — hands-free voice link for LiuLiu.
 * Records only while speaking. VAD must run even before UI "enabled" is painted.
 */
(function () {
  const SILENCE_MS = 480;
  const MIN_SPEECH_MS = 280;
  const SPEECH_START_FRAMES = 2;
  const VU_BARS = 18;
  const BASE_RMS = 0.008;

  function isVoiceStopCommand(text) {
    const t = String(text || '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-яіїєґ0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(будь ласка|please)\s+/, '')
      .replace(/\s+(будь ласка|please)$/, '');
    if (!t) return false;
    if (t === 'стоп стоп' || t === 'stop stop') return true;
    return /^(стоп|stop|зупинись|зупинися|зупинити|вимкни|вимкнути|виключи|доволі|досить)(\s+(голос|войс|voice|мікрофон|парарейд|pararaid|режим))?$/.test(t);
  }

  class VoiceModeController {
    constructor(app) {
      this.app = app;
      this.enabled = false;
      this.busy = false;
      this.listening = false;
      this.stream = null;
      this.audioCtx = null;
      this.analyser = null;
      this.mediaRecorder = null;
      this.chunks = [];
      this.rafId = null;
      this.silenceStartedAt = 0;
      this.speechStartedAt = 0;
      this.speechFrameHits = 0;
      this.inSpeech = false;
      this.wakeLock = null;
      this.currentAudio = null;
      this.statusEl = null;
      this.btnEl = null;
      this.hudEl = null;
      this.hudStageEl = null;
      this.hudDetailEl = null;
      this.vuEl = null;
      this.vuBars = [];
      this.noiseFloor = 0.004;
      this.peakRms = 0;
      this.useByteDomain = false;
      this._floatBuf = null;
      this._byteBuf = null;
      this._onVisibility = () => this.reacquireWakeLock();
    }

    init() {
      this.btnEl = document.getElementById('voice-mode-btn');
      this.statusEl = document.getElementById('voice-mode-status');
      this.hudEl = document.getElementById('pararaid-hud');
      this.hudStageEl = document.getElementById('pararaid-hud-stage');
      this.hudDetailEl = document.getElementById('pararaid-hud-detail');
      this.vuEl = document.getElementById('pararaid-vu');
      if (this.vuEl && !this.vuEl.children.length) {
        for (let i = 0; i < VU_BARS; i++) {
          this.vuEl.appendChild(document.createElement('span'));
        }
        this.vuBars = [...this.vuEl.children];
      }
      if (!this.btnEl) return;
      this.btnEl.addEventListener('click', () => this.toggle());
      this.refreshAvailability();
    }

    async refreshAvailability() {
      if (!this.btnEl || !this.app.token) return;
      try {
        const res = await fetch('/api/voice/status', {
          headers: { Authorization: `Bearer ${this.app.token}` },
        });
        if (!res.ok) throw new Error('status failed');
        const data = await res.json();
        this.btnEl.disabled = !data.enabled;
        this.btnEl.title = data.enabled
          ? "ParaRaid — голосовий зв'язок (hands-free)"
          : 'ParaRaid недоступний (немає API ключів на сервері)';
        if (!data.enabled && this.enabled) {
          await this.setEnabled(false);
        }
      } catch {
        this.btnEl.disabled = true;
        this.btnEl.title = 'Не вдалося перевірити ParaRaid API';
      }
    }

    setHud(stage, state, detail) {
      if (this.hudEl) {
        this.hudEl.hidden = !this.enabled;
      }
      if (this.hudStageEl) {
        this.hudStageEl.textContent = stage || '';
        this.hudStageEl.dataset.state = state || '';
      }
      if (this.hudDetailEl && detail != null) {
        this.hudDetailEl.textContent = detail;
      }
      if (this.statusEl) {
        this.statusEl.textContent = stage || '';
        this.statusEl.dataset.state = state === 'speech' ? 'listening' : state || '';
        this.statusEl.style.display = this.enabled && stage ? 'inline-flex' : 'none';
      }
    }

    paintVu(rms) {
      if (!this.vuBars.length) return;
      const level = Math.min(1, rms / 0.12);
      this.vuBars.forEach((bar, i) => {
        const t = (i + 1) / this.vuBars.length;
        const on = level >= t * 0.55;
        const h = on ? Math.max(5, Math.round(4 + level * 24 * (0.4 + t))) : 4;
        bar.style.height = `${h}px`;
        bar.classList.toggle('on', on);
      });
    }

    async toggle() {
      await this.setEnabled(!this.enabled);
    }

    unlockPlayback() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        if (!this.audioCtx || this.audioCtx.state === 'closed') {
          this.audioCtx = new Ctx();
        }
        this.audioCtx.resume();
        const buf = this.audioCtx.createBuffer(1, 1, this.audioCtx.sampleRate || 44100);
        const src = this.audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(this.audioCtx.destination);
        src.start(0);
        this._audioUnlocked = true;
      } catch (err) {
        console.warn('[ParaRaid] audio unlock failed', err);
      }
    }

    async ensureAudioCtx() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio не підтримується');
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new Ctx();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      return this.audioCtx;
    }

    async setEnabled(on) {
      if (on === this.enabled) return;
      if (on) {
        this.unlockPlayback();
        if (!this.app.activeSessionId) {
          try {
            this.setHud('Сесія…', 'thinking', 'Створюю чат для голосового звʼязку');
            this.app.showToast?.('✨ Створюю чат…');
            await this.app.ensureActiveSession?.('cursor');
          } catch (err) {
            this.app.showToast?.(err?.message || 'Спочатку відкрийте або створіть чат', 4500);
            return;
          }
        }
        try {
          // Must be true BEFORE VAD loop — otherwise loopVad() exits immediately.
          this.enabled = true;
          this.btnEl?.classList.add('active');
          this.btnEl?.setAttribute('aria-pressed', 'true');
          if (this.hudEl) this.hudEl.hidden = false;
          this.setHud('Мікрофон…', 'thinking', 'Запит доступу до мікрофона');
          await this.startListeningPipeline();
          this.setHud('Слухаю', 'listening', 'Говоріть — смужки мають стрибати від голосу');
          await this.acquireWakeLock();
          document.addEventListener('visibilitychange', this._onVisibility);
          this.app.showToast?.('ParaRaid увімкнено — говоріть, після паузи піде в чат');
        } catch (err) {
          console.error('[ParaRaid] start failed', err);
          this.app.showToast?.(`Немає доступу до мікрофона: ${err.message || err}`, 5000);
          this.enabled = false;
          await this.cleanupMedia();
          this.btnEl?.classList.remove('active');
          this.btnEl?.setAttribute('aria-pressed', 'false');
          this.setHud('', '', '');
          if (this.hudEl) this.hudEl.hidden = true;
        }
      } else {
        this.enabled = false;
        this.busy = false;
        this.btnEl?.classList.remove('active');
        this.btnEl?.setAttribute('aria-pressed', 'false');
        if (this.hudEl) this.hudEl.hidden = true;
        this.setHud('', '', '');
        this.stopPlayback();
        await this.cleanupMedia();
        await this.releaseWakeLock();
        document.removeEventListener('visibilitychange', this._onVisibility);
        this.app.showToast?.('ParaRaid вимкнено');
      }
    }

    consumeStopCommand(text) {
      if (!isVoiceStopCommand(text)) return false;
      this.busy = false;
      this.setEnabled(false);
      if (this.app.isStreaming) this.app.stopAgent();
      return true;
    }

    async acquireWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          this.wakeLock = await navigator.wakeLock.request('screen');
          this.wakeLock.addEventListener('release', () => {
            this.wakeLock = null;
          });
        }
      } catch (err) {
        console.warn('[ParaRaid] Wake Lock unavailable', err);
      }
    }

    async reacquireWakeLock() {
      if (!this.enabled || document.visibilityState !== 'visible') return;
      if (!this.wakeLock) await this.acquireWakeLock();
    }

    async releaseWakeLock() {
      try {
        await this.wakeLock?.release();
      } catch {
        /* ignore */
      }
      this.wakeLock = null;
    }

    async startListeningPipeline() {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const ctx = await this.ensureAudioCtx();
      const source = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.35;
      source.connect(this.analyser);
      this._floatBuf = new Float32Array(this.analyser.fftSize);
      this._byteBuf = new Uint8Array(this.analyser.fftSize);
      this.useByteDomain = typeof this.analyser.getFloatTimeDomainData !== 'function';
      this.listening = true;
      this.busy = false;
      this.inSpeech = false;
      this.speechFrameHits = 0;
      this.silenceStartedAt = 0;
      this.speechStartedAt = 0;
      this.noiseFloor = 0.004;
      this.peakRms = 0;
      this.loopVad();
    }

    readRms() {
      if (!this.analyser) return 0;
      if (!this.useByteDomain) {
        try {
          this.analyser.getFloatTimeDomainData(this._floatBuf);
          let sum = 0;
          for (let i = 0; i < this._floatBuf.length; i++) {
            const v = this._floatBuf[i];
            sum += v * v;
          }
          const rms = Math.sqrt(sum / this._floatBuf.length);
          // Safari sometimes returns all zeros for float domain
          if (rms > 0.00001 || this.peakRms > 0) return rms;
          this.useByteDomain = true;
        } catch {
          this.useByteDomain = true;
        }
      }
      this.analyser.getByteTimeDomainData(this._byteBuf);
      let sum = 0;
      for (let i = 0; i < this._byteBuf.length; i++) {
        const v = (this._byteBuf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / this._byteBuf.length);
    }

    pickMimeType() {
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      for (const t of candidates) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
      }
      return '';
    }

    startRecorder() {
      if (!this.stream) return;
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') return;
      this.chunks = [];
      const mimeType = this.pickMimeType();
      try {
        this.mediaRecorder = mimeType
          ? new MediaRecorder(this.stream, { mimeType })
          : new MediaRecorder(this.stream);
      } catch (err) {
        console.error('[ParaRaid] MediaRecorder failed', err);
        this.mediaRecorder = new MediaRecorder(this.stream);
      }
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.start(180);
    }

    loopVad() {
      if (!this.listening || !this.analyser) return;
      const rms = this.readRms();
      this.peakRms = Math.max(this.peakRms * 0.96, rms);
      if (!this.inSpeech) {
        this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
      }
      const threshold = Math.max(BASE_RMS, this.noiseFloor * 3.2 + 0.004);
      this.paintVu(rms);

      const now = Date.now();
      if (!this.busy) {
        if (rms >= threshold) {
          this.speechFrameHits++;
          this.silenceStartedAt = 0;
          if (!this.inSpeech && this.speechFrameHits >= SPEECH_START_FRAMES) {
            this.inSpeech = true;
            this.speechStartedAt = now;
            this.startRecorder();
            this.setHud('Говорите', 'speech', 'Запис… після паузи розпізнаю і надішлю');
          }
        } else {
          this.speechFrameHits = 0;
          if (this.inSpeech) {
            if (!this.silenceStartedAt) this.silenceStartedAt = now;
            if (now - this.silenceStartedAt >= SILENCE_MS) {
              const spokenFor = now - this.speechStartedAt;
              this.inSpeech = false;
              this.silenceStartedAt = 0;
              if (spokenFor >= MIN_SPEECH_MS) {
                this.finalizeUtterance();
                return;
              }
              this.discardRecorder();
              this.setHud('Слухаю', 'listening', 'Занадто коротко — скажіть ще раз');
            }
          } else if (this.enabled) {
            const live = this.peakRms < BASE_RMS * 0.6
              ? 'Смужки майже не рухаються — перевірте мікрофон / дозвіл Safari'
              : 'Говоріть — смужки стрибають від голосу';
            if (this.hudDetailEl && !this.inSpeech) {
              this.hudDetailEl.textContent = live;
            }
          }
        }
      }

      this.rafId = requestAnimationFrame(() => this.loopVad());
    }

    pauseListening() {
      this.listening = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    resumeListening() {
      if (!this.enabled || this.busy) return;
      if (!this.stream) return;
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      this.listening = true;
      this.inSpeech = false;
      this.speechFrameHits = 0;
      this.silenceStartedAt = 0;
      this.setHud('Слухаю', 'listening', 'Говоріть — смужки мають стрибати від голосу');
      this.loopVad();
    }

    discardRecorder() {
      try {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.ondataavailable = null;
          this.mediaRecorder.onstop = null;
          this.mediaRecorder.stop();
        }
      } catch {
        /* ignore */
      }
      this.mediaRecorder = null;
      this.chunks = [];
    }

    async finalizeUtterance() {
      if (this.busy || !this.enabled) return;
      this.busy = true;
      this.pauseListening();
      this.setHud('Розпізнаю', 'thinking', 'Відправляю запис на транскрипцію…');

      try {
        const blob = await this.stopRecorderToBlob();
        if (!blob || blob.size < 400) {
          this.app.showToast?.('Занадто коротко — повторіть', 2500);
          this.setHud('Слухаю', 'listening', 'Запис порожній — повторіть голосніше');
          this.busy = false;
          this.resumeListening();
          return;
        }

        this.setHud('Розпізнаю', 'thinking', `Аудіо ${(blob.size / 1024).toFixed(1)} KB → ElevenLabs Scribe`);
        const base64 = await this.blobToBase64(blob);
        const mimeType = (blob.type || 'audio/webm').split(';')[0];
        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.app.token}`,
          },
          body: JSON.stringify({
            audioBase64: base64,
            mimeType,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Transcribe failed');

        const text = (data.text || '').trim();
        if (!text) {
          this.app.showToast?.('Не розчув — спробуйте ще раз');
          this.setHud('Слухаю', 'listening', 'Порожня транскрипція — скажіть чіткіше');
          this.busy = false;
          this.resumeListening();
          return;
        }

        if (this.consumeStopCommand(text)) {
          return;
        }

        if (this.app.promptInput) {
          this.app.promptInput.value = text;
          this.app.promptInput.style.height = 'auto';
          this.app.promptInput.style.height = `${Math.min(this.app.promptInput.scrollHeight, 160)}px`;
        }

        this.setHud('Надсилаю', 'thinking', text.length > 80 ? `${text.slice(0, 80)}…` : text);
        const sent = await this.app.sendPrompt?.();
        if (sent === false) {
          this.busy = false;
          this.resumeListening();
          return;
        }
        if (sent !== true && !this.app.isStreaming) {
          this.busy = false;
          this.resumeListening();
          return;
        }
        this.setHud('Агент', 'thinking', 'Чекаю відповідь агента…');
      } catch (err) {
        console.error('[ParaRaid] utterance failed', err);
        this.app.showToast?.(`Помилка розпізнавання: ${err.message || err}`, 5000);
        this.setHud('Помилка', 'error', String(err.message || err).slice(0, 140));
        this.busy = false;
        this.resumeListening();
      }
    }

    stopRecorderToBlob() {
      return new Promise((resolve) => {
        const recorder = this.mediaRecorder;
        if (!recorder || recorder.state === 'inactive') {
          resolve(null);
          return;
        }
        const finish = () => {
          const mime = (recorder.mimeType || 'audio/webm').split(';')[0];
          const blob = new Blob(this.chunks, { type: mime });
          this.chunks = [];
          this.mediaRecorder = null;
          resolve(blob);
        };
        recorder.onstop = finish;
        try {
          if (recorder.state === 'recording') recorder.requestData?.();
          recorder.stop();
        } catch {
          finish();
        }
      });
    }

    blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = String(reader.result || '');
          const idx = result.indexOf(',');
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    async onAgentComplete(session, options = {}) {
      if (!this.enabled) return;
      if (options.aborted) {
        this.busy = false;
        this.resumeListening();
        return;
      }

      if (session && session.promptQueue && session.promptQueue.length > 0) {
        this.setHud('Агент', 'thinking', 'Ще є черга — чекаю…');
        return;
      }

      const lastAssistant = [...(session?.messages || [])].reverse().find((m) => m.role === 'assistant');
      const fromDom = this.readLastAssistantText();
      const text = (options.spokenText || fromDom || lastAssistant?.content || '').trim();
      const hasToolCalls = Boolean(
        options.hasToolCalls || (lastAssistant?.toolCalls && lastAssistant.toolCalls.length > 0)
      );

      if (options.success === false) {
        this.app.showToast?.(`⚠️ ${options.error || 'Агент завершився з помилкою'}`, 5000);
        this.setHud('Помилка агента', 'error', String(options.error || 'помилка').slice(0, 140));
        this.busy = false;
        this.resumeListening();
        return;
      }

      if (!text) {
        this.busy = false;
        this.resumeListening();
        return;
      }

        this.setHud('Озвучую', 'speaking', 'ElevenLabs озвучує відповідь…');
        try {
          const res = await fetch('/api/voice/speak', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.app.token}`,
            },
            body: JSON.stringify({ text: text.slice(0, 4000), hasToolCalls }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Speak failed ${res.status}`);
          }
          const buf = await res.arrayBuffer();
          if (!buf || buf.byteLength < 64) {
            throw new Error('Порожній аудіофайл від сервера');
          }
          await this.playAudioBuffer(buf);
        } catch (err) {
          console.error('[ParaRaid] speak failed', err);
          this.app.showToast?.(`Не вдалося озвучити: ${String(err.message || err).slice(0, 120)}`, 5000);
          this.setHud('Слухаю', 'listening', `TTS: ${String(err.message || err).slice(0, 80)}`);
        } finally {
        this.busy = false;
        if (this.enabled) this.resumeListening();
      }
    }

    readLastAssistantText() {
      const nodes = this.app.chatMessages?.querySelectorAll?.('.message.assistant .message-bubble');
      if (!nodes || !nodes.length) return '';
      const last = nodes[nodes.length - 1];
      return (last.rawMarkdown || last.innerText || '').trim();
    }

    decodeAudioData(ctx, arrayBuffer) {
      const copy = arrayBuffer.slice(0);
      return new Promise((resolve, reject) => {
        let settled = false;
        const ok = (buf) => {
          if (settled) return;
          settled = true;
          resolve(buf);
        };
        const fail = (err) => {
          if (settled) return;
          settled = true;
          reject(err || new Error('decodeAudioData failed'));
        };
        try {
          const ret = ctx.decodeAudioData(copy, ok, fail);
          if (ret && typeof ret.then === 'function') ret.then(ok, fail);
        } catch (err) {
          fail(err);
        }
      });
    }

    arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    }

    async playAudioBuffer(arrayBuffer) {
      this.stopPlayback();
      const ctx = await this.ensureAudioCtx();
      try {
        const decoded = await this.decodeAudioData(ctx, arrayBuffer);
        await new Promise((resolve, reject) => {
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(ctx.destination);
          this._ttsSource = src;
          src.onended = () => {
            if (this._ttsSource === src) this._ttsSource = null;
            resolve();
          };
          try {
            src.start(0);
          } catch (err) {
            reject(err);
          }
        });
        return;
      } catch (err) {
        console.warn('[ParaRaid] Web Audio TTS failed, HTMLAudio fallback', err);
      }

      const url = `data:audio/mpeg;base64,${this.arrayBufferToBase64(arrayBuffer)}`;
      await new Promise((resolve, reject) => {
        const audio = new Audio();
        audio.playsInline = true;
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
        audio.preload = 'auto';
        audio.src = url;
        this.currentAudio = audio;
        const done = (error) => {
          if (this.currentAudio === audio) this.currentAudio = null;
          if (error) reject(error);
          else resolve();
        };
        audio.onended = () => done();
        audio.onerror = () => done(new Error('Відтворення MP3 не вдалося'));
        const playAttempt = audio.play();
        if (playAttempt && typeof playAttempt.then === 'function') {
          playAttempt.catch((e) => done(new Error(e?.message || 'Браузер заблокував звук')));
        }
      });
    }

    stopPlayback() {
      if (this._ttsSource) {
        try {
          this._ttsSource.stop();
        } catch {
          /* ignore */
        }
        this._ttsSource = null;
      }
      if (this.currentAudio) {
        try {
          this.currentAudio.pause();
        } catch {
          /* ignore */
        }
        this.currentAudio = null;
      }
    }

    async cleanupMedia() {
      this.pauseListening();
      this.discardRecorder();
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      if (this.audioCtx) {
        try {
          await this.audioCtx.close();
        } catch {
          /* ignore */
        }
        this.audioCtx = null;
      }
      this.analyser = null;
      this.busy = false;
      this.listening = false;
    }

    onAgentStart() {
      if (!this.enabled) return;
      this.busy = true;
      this.pauseListening();
      this.discardRecorder();
      this.setHud('Агент', 'thinking', 'Агент виконує завдання…');
    }
  }

  window.VoiceModeController = VoiceModeController;
})();
