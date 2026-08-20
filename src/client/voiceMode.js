/**
 * ParaRaid — hands-free voice link for LiuLiu.
 * Expects window.app with token, sendPrompt, showToast.
 */
(function () {
  const SILENCE_MS = 1200;
  const MIN_SPEECH_MS = 450;
  const RMS_THRESHOLD = 0.018;
  const SPEECH_START_FRAMES = 3;

  class VoiceModeController {
    constructor(app) {
      this.app = app;
      this.enabled = false;
      this.busy = false; // transcribing / waiting agent / speaking
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
      this._onVisibility = () => this.reacquireWakeLock();
    }

    init() {
      this.btnEl = document.getElementById('voice-mode-btn');
      this.statusEl = document.getElementById('voice-mode-status');
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

    setStatus(text, state) {
      if (!this.statusEl) return;
      this.statusEl.textContent = text || '';
      this.statusEl.dataset.state = state || '';
      this.statusEl.style.display = text ? 'inline-flex' : 'none';
    }

    async toggle() {
      await this.setEnabled(!this.enabled);
    }

    async setEnabled(on) {
      if (on === this.enabled) return;
      if (on) {
        try {
          await this.startListeningPipeline();
          this.enabled = true;
          this.btnEl?.classList.add('active');
          this.btnEl?.setAttribute('aria-pressed', 'true');
          this.setStatus('На звʼязку…', 'listening');
          await this.acquireWakeLock();
          document.addEventListener('visibilitychange', this._onVisibility);
          this.app.showToast?.('ParaRaid увімкнено — говоріть, пауза надішле повідомлення');
        } catch (err) {
          console.error('[ParaRaid] start failed', err);
          this.app.showToast?.('Немає доступу до мікрофона', 5000);
          await this.cleanupMedia();
          this.enabled = false;
          this.btnEl?.classList.remove('active');
          this.btnEl?.setAttribute('aria-pressed', 'false');
          this.setStatus('', '');
        }
      } else {
        this.enabled = false;
        this.btnEl?.classList.remove('active');
        this.btnEl?.setAttribute('aria-pressed', 'false');
        this.setStatus('', '');
        this.stopPlayback();
        await this.cleanupMedia();
        await this.releaseWakeLock();
        document.removeEventListener('visibilitychange', this._onVisibility);
        this.app.showToast?.('ParaRaid вимкнено');
      }
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
        console.warn('[VoiceMode] Wake Lock unavailable', err);
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
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      source.connect(this.analyser);
      this.startRecorder();
      this.listening = true;
      this.busy = false;
      this.inSpeech = false;
      this.speechFrameHits = 0;
      this.silenceStartedAt = 0;
      this.speechStartedAt = 0;
      this.loopVad();
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
      this.chunks = [];
      const mimeType = this.pickMimeType();
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.start(250);
    }

    loopVad() {
      if (!this.enabled || !this.analyser || !this.listening) return;
      const data = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const now = Date.now();

      if (!this.busy) {
        if (rms >= RMS_THRESHOLD) {
          this.speechFrameHits++;
          this.silenceStartedAt = 0;
          if (!this.inSpeech && this.speechFrameHits >= SPEECH_START_FRAMES) {
            this.inSpeech = true;
            this.speechStartedAt = now;
            this.setStatus('Ефір…', 'listening');
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
      this.listening = true;
      this.inSpeech = false;
      this.speechFrameHits = 0;
      this.silenceStartedAt = 0;
      this.setStatus('На звʼязку…', 'listening');
      this.loopVad();
    }

    async finalizeUtterance() {
      if (this.busy || !this.enabled) return;
      this.busy = true;
      this.pauseListening();
      this.setStatus('Синхрон…', 'thinking');

      try {
        const blob = await this.stopRecorderToBlob();
        if (!blob || blob.size < 200) {
          this.busy = false;
          this.startRecorder();
          this.resumeListening();
          return;
        }

        const base64 = await this.blobToBase64(blob);
        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.app.token}`,
          },
          body: JSON.stringify({
            audioBase64: base64,
            mimeType: blob.type || 'audio/webm',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Transcribe failed');

        const text = (data.text || '').trim();
        if (!text) {
          this.app.showToast?.('Не розчув — спробуйте ще раз');
          this.busy = false;
          this.startRecorder();
          this.resumeListening();
          return;
        }

        if (this.app.promptInput) {
          this.app.promptInput.value = text;
          this.app.promptInput.style.height = 'auto';
          this.app.promptInput.style.height = `${Math.min(this.app.promptInput.scrollHeight, 160)}px`;
        }

        this.setStatus('Handler…', 'thinking');
        this.app.sendPrompt?.();
        // Listening resumes after speak/complete via onAgentComplete
      } catch (err) {
        console.error('[VoiceMode] utterance failed', err);
        this.app.showToast?.('Помилка розпізнавання мови', 4000);
        this.busy = false;
        this.startRecorder();
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
        recorder.onstop = () => {
          const mime = recorder.mimeType || 'audio/webm';
          const blob = new Blob(this.chunks, { type: mime });
          this.chunks = [];
          this.mediaRecorder = null;
          resolve(blob);
        };
        try {
          recorder.stop();
        } catch {
          resolve(null);
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
        this.startRecorder();
        this.resumeListening();
        return;
      }

      // If queue continues, stay in thinking state
      if (session && session.promptQueue && session.promptQueue.length > 0) {
        this.setStatus('Handler…', 'thinking');
        return;
      }

      const lastAssistant = [...(session?.messages || [])].reverse().find((m) => m.role === 'assistant');
      const text = (lastAssistant?.content || '').trim();
      const hasToolCalls = Boolean(lastAssistant?.toolCalls && lastAssistant.toolCalls.length > 0);

      if (!text) {
        this.busy = false;
        this.startRecorder();
        this.resumeListening();
        return;
      }

      this.setStatus('Передача…', 'speaking');
      try {
        const res = await fetch('/api/voice/speak', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.app.token}`,
          },
          body: JSON.stringify({ text, hasToolCalls }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Speak failed ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        await this.playAudioBuffer(buf);
      } catch (err) {
        console.error('[VoiceMode] speak failed', err);
        this.app.showToast?.('Не вдалося озвучити відповідь', 4000);
      } finally {
        this.busy = false;
        if (this.enabled) {
          this.startRecorder();
          this.resumeListening();
        }
      }
    }

    playAudioBuffer(arrayBuffer) {
      return new Promise((resolve) => {
        this.stopPlayback();
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.currentAudio = audio;
        const done = () => {
          URL.revokeObjectURL(url);
          if (this.currentAudio === audio) this.currentAudio = null;
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      });
    }

    stopPlayback() {
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
      try {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.onstop = null;
          this.mediaRecorder.stop();
        }
      } catch {
        /* ignore */
      }
      this.mediaRecorder = null;
      this.chunks = [];
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

    /** Call when agent starts running so mic doesn't capture during tools */
    onAgentStart() {
      if (!this.enabled) return;
      this.busy = true;
      this.pauseListening();
      this.setStatus('Handler…', 'thinking');
    }
  }

  window.VoiceModeController = VoiceModeController;
})();
