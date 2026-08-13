import type { MicRecorder } from "./WhisperSttProvider.js";

/**
 * 브라우저 마이크 → 16kHz mono PCM.
 *
 * <p>Whisper가 요구하는 입력이 16kHz mono Float32라 그 형태로 맞춰 준다. 리샘플링을
 * 직접 하지 않고 <b>`decodeAudioData`에게 맡긴다</b> — `AudioContext`를 16000Hz로 만들면
 * 디코딩하면서 그 비율로 변환해 준다. 손으로 짠 리샘플러보다 정확하고, 무엇보다
 * 브라우저마다 다른 기본 샘플레이트(44.1k·48k)를 신경 쓰지 않아도 된다.
 *
 * <p>`ScriptProcessorNode`로 실시간 수집하는 방법도 있지만 쓰지 않았다. 폐기 예정
 * API인 데다 오디오 스레드에서 도는 콜백을 다루게 되는데, <b>여기서 실시간이 필요하지
 * 않다</b> — Whisper는 어차피 말이 끝나야 옮기기 시작한다.
 *
 * <p>마이크는 버튼을 누른 동안만 열린다. 끝나면 트랙을 확실히 닫는다 — 브라우저 탭에
 * 녹음 표시가 남아 있는 것은 사용자에게 "아직 듣고 있다"로 읽힌다 (기획안 §11.2).
 */
export class BrowserMicRecorder implements MicRecorder {
  #stream: MediaStream | null = null;
  #recorder: MediaRecorder | null = null;
  #chunks: Blob[] = [];

  get isSupported(): boolean {
    return (
      typeof globalThis !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      typeof AudioContext !== "undefined" &&
      navigator?.mediaDevices?.getUserMedia !== undefined
    );
  }

  async start(): Promise<void> {
    // 잡음 억제와 에코 제거는 켜 둔다. 고령 사용자는 조용한 방에서만 쓰지 않는다.
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    this.#chunks = [];
    this.#recorder = new MediaRecorder(this.#stream);
    this.#recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    };
    this.#recorder.start();
  }

  async stop(): Promise<Float32Array> {
    const recorder = this.#recorder;
    if (!recorder) return new Float32Array(0);

    const recorded = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== "inactive") recorder.stop();
    await recorded;

    this.#release();

    const blob = new Blob(this.#chunks, { type: recorder.mimeType });
    this.#chunks = [];
    if (blob.size === 0) return new Float32Array(0);

    // 여기서 16000을 요구하면 디코딩이 그 비율로 변환해 준다.
    const context = new AudioContext({ sampleRate: 16_000 });
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      // Whisper는 mono를 받는다. 첫 채널만 쓴다.
      return decoded.getChannelData(0);
    } finally {
      void context.close();
    }
  }

  #release(): void {
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
    this.#recorder = null;
  }
}
