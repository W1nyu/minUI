import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebSpeechSttProvider } from "@minui/voice";
import { DEFAULT_CONFIG, buildBiasPhrases, type MenuCatalog } from "@minui/core";
import { ALL_SITES } from "./sites.js";
import promptFile from "../../tools/fixtures/stt-prompts.json";

/**
 * 음성 코퍼스 수집 화면 (M21 Task 5). **개발 전용 — 배포 번들에 들어가지 않는다.**
 *
 * <p>이 프로젝트의 모든 검색 수치는 <b>손으로 친 텍스트</b>로 잰 것이다. 간판 입력 경로인
 * 음성은 한 번도 실제 STT로 측정된 적이 없다. 그 공백을 메우려면 사람이 말한 것과
 * 인식기가 적은 것을 짝지어 모아야 하고, Web Speech는 브라우저에만 있으므로
 * 그 일을 하는 화면이 필요하다.
 *
 * <h3>오디오를 저장하지 않는다</h3>
 *
 * <p>남는 것은 <b>문자열 쌍</b>뿐이다 — 무엇을 읽으라고 했고 무엇으로 적혔는가.
 * 음성 원본은 이 화면이 애초에 손대지 않는다(기획안 §11.2). 그래서 모은 파일에
 * 개인을 식별할 것이 없고, 화자는 익명 id로만 남는다.
 *
 * <h3>TTS 모드가 안 되면</h3>
 *
 * <p>브라우저는 스피커로 나간 소리를 마이크로 되받는다. Chrome의 에코 제거가 그 소리를
 * 지워 버리면 인식이 통째로 실패한다. 그때는 시스템 루프백(Windows `Stereo Mix`,
 * VB-Audio Cable 등)을 기본 입력 장치로 잡으면 된다. <b>화면이 그 실패를 숨기지 않는다</b> —
 * 실패도 한 줄로 남아 몇 건이 비었는지 바로 보인다.
 */

interface Prompt {
  id: string;
  text: string;
  site: string;
  expect?: string;
}

/** 발화를 어디서 얻었는가. 층위를 섞어 평균내지 않기 위해 반드시 남긴다. */
type Source = "tts-synthetic" | "self-recorded" | "thirdparty-recorded";

const SOURCE_LABEL: Record<Source, string> = {
  "tts-synthetic": "TTS 합성",
  "self-recorded": "본인 낭독",
  "thirdparty-recorded": "다른 사람 낭독",
};

/** 모은 한 줄. 이대로 `tools/fixtures/stt-corpus.json`에 들어간다. */
interface Row {
  promptId: string;
  site: string;
  intended: string;
  expect?: string;
  /** 1순위로 적힌 말. 인식 실패면 빈 문자열이다. */
  heard: string;
  /** 대안까지. 1순위를 첫 칸으로 포함한다. */
  alternatives: string[];
  confidence: number;
  source: Source;
  /** 익명 화자 id. TTS면 목소리 이름. */
  speaker: string;
  /** TTS 재생 속도. 사람 낭독이면 없다. */
  rate?: number;
  /** 인식이 실패했으면 그 까닭. */
  error?: string;
  /** 카탈로그를 인식기에 알려 주고 받았는가 (M22). */
  bias: boolean;
  /** 인식이 기기 안에서 돌았는가 (M22). 브라우저가 알려 주지 않으면 없다. */
  local?: boolean;
}

const PROMPTS = (promptFile as { prompts: Prompt[] }).prompts;

export function SttLab() {
  const [source, setSource] = useState<Source>("tts-synthetic");
  const [speaker, setSpeaker] = useState("");
  const [rate, setRate] = useState(1);
  const [voiceName, setVoiceName] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [index, setIndex] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("준비됨");
  const [running, setRunning] = useState(false);
  const [heard, setHeard] = useState("");
  const [bias, setBias] = useState(false);
  const [wantLocal, setWantLocal] = useState(false);
  const [support, setSupport] = useState("확인 중");

  const stopped = useRef(false);
  const stt = useMemo(() => new WebSpeechSttProvider({ maxAlternatives: 5 }), []);

  /*
   * 이 브라우저가 M22를 받을 수 있는지 눈에 보이게 찍는다. 스파이크를 화면에 남긴 것이다 —
   * 다른 기기에서 다시 물어볼 때 콘솔을 열지 않아도 된다.
   */
  useEffect(() => {
    const SR = (globalThis as Record<string, unknown>)["SpeechRecognition"] ??
      (globalThis as Record<string, unknown>)["webkitSpeechRecognition"];
    if (typeof SR !== "function") {
      setSupport("음성 인식 없음");
      return;
    }
    const proto = SR.prototype as object;
    const hasPhrases = "phrases" in proto;
    const hasLocal = "processLocally" in proto;
    const available = (SR as unknown as {
      available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
    }).available;

    const base = `편향 ${hasPhrases ? "가능" : "없음"} · 온디바이스 훅 ${hasLocal ? "있음" : "없음"}`;
    if (typeof available !== "function") {
      setSupport(`${base} · ko-KR 언어팩 확인 불가`);
      return;
    }
    void available({ langs: ["ko-KR"], processLocally: true })
      .then((state) => setSupport(`${base} · ko-KR 언어팩 ${state}`))
      .catch(() => setSupport(`${base} · ko-KR 언어팩 확인 실패`));
  }, []);

  /** 프롬프트가 가리키는 사이트의 카탈로그. 실사용에서는 앱이 하나만 들고 있다. */
  const catalogOf = useCallback((site: string): MenuCatalog => {
    return ALL_SITES.find((meta) => meta.catalogId === site)?.catalog ?? [];
  }, []);

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const korean = useMemo(
    () => voices.filter((voice) => voice.lang.toLowerCase().startsWith("ko")),
    [voices],
  );

  useEffect(() => {
    if (voiceName === "" && korean[0]) setVoiceName(korean[0].name);
  }, [korean, voiceName]);

  /** 한 문장을 재생하고, 동시에 듣고, 한 줄을 돌려준다. */
  const capture = useCallback(
    (prompt: Prompt): Promise<Row> =>
      new Promise((resolve) => {
        const base = {
          promptId: prompt.id,
          site: prompt.site,
          intended: prompt.text,
          ...(prompt.expect !== undefined ? { expect: prompt.expect } : {}),
          source,
          speaker: source === "tts-synthetic" ? voiceName : speaker,
          ...(source === "tts-synthetic" ? { rate } : {}),
          bias,
        };

        let settled = false;
        let timer = 0;
        const finish = (row: Row) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          offFinal();
          offError();
          stt.stop();
          window.speechSynthesis.cancel();
          resolve(row);
        };

        const offFinal = stt.onFinal((result) => {
          setHeard(result.text);
          finish({
            ...base,
            heard: result.text,
            alternatives: (result.alternatives ?? [{ text: result.text }]).map((a) => a.text),
            confidence: result.confidence,
            ...(result.local !== undefined ? { local: result.local } : {}),
          });
        });

        const offError = stt.onError((error) => {
          finish({
            ...base,
            heard: "",
            alternatives: [],
            confidence: 0,
            error: error.code,
          });
        });

        /*
         * 편향과 온디바이스를 `start()` 전에 건다 (M22). 실사용에서 `VoiceSearchSheet`가
         * 하는 것과 같은 순서다 — 여기서만 다르게 하면 재는 것이 제품과 달라진다.
         */
        stt.preferLocal?.(wantLocal);
        stt.setPhrases?.(
          bias
            ? buildBiasPhrases(
                catalogOf(prompt.site),
                new Map(),
                { ...DEFAULT_CONFIG.search.bias, enabled: true },
              )
            : [],
        );

        /*
         * 마이크를 먼저 연다. TTS가 먼저 나가면 앞부분을 놓친다 — 실제로
         * 첫 음절이 잘린 인식이 계속 나와서 순서를 바꿨다.
         */
        void stt.start().then(() => {
          if (source !== "tts-synthetic") return;
          const utterance = new SpeechSynthesisUtterance(prompt.text);
          utterance.lang = "ko-KR";
          utterance.rate = rate;
          const voice = voices.find((candidate) => candidate.name === voiceName);
          if (voice) utterance.voice = voice;
          window.speechSynthesis.speak(utterance);
        });

        // 브라우저가 아무 말도 없다고 끝내 주지 않는 경우가 있다. 상한을 씌운다.
        timer = window.setTimeout(() => {
          finish({ ...base, heard: "", alternatives: [], confidence: 0, error: "timeout" });
        }, 12_000);
      }),
    [bias, catalogOf, rate, source, speaker, stt, voiceName, voices, wantLocal],
  );

  async function runAll() {
    if (source !== "tts-synthetic" && speaker.trim().length === 0) {
      setStatus("화자 id를 먼저 적어 주세요 (익명 별칭이면 됩니다).");
      return;
    }
    stopped.current = false;
    setRunning(true);

    for (let i = index; i < PROMPTS.length; i++) {
      if (stopped.current) break;
      const prompt = PROMPTS[i]!;
      setIndex(i);
      setHeard("");
      setStatus(`${i + 1} / ${PROMPTS.length} — "${prompt.text}"`);
      const row = await capture(prompt);
      setRows((previous) => [...previous, row]);
      // 인식기가 다음 발화를 받을 준비를 할 틈.
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }

    setRunning(false);
    setStatus(stopped.current ? "멈췄습니다." : "끝났습니다.");
  }

  async function captureOne() {
    if (source !== "tts-synthetic" && speaker.trim().length === 0) {
      setStatus("화자 id를 먼저 적어 주세요.");
      return;
    }
    const prompt = PROMPTS[index];
    if (!prompt) return;
    setRunning(true);
    setHeard("");
    setStatus(`듣는 중 — "${prompt.text}"`);
    const row = await capture(prompt);
    setRows((previous) => [...previous, row]);
    setIndex((value) => Math.min(value + 1, PROMPTS.length - 1));
    setRunning(false);
    setStatus(row.error ? `실패: ${row.error}` : `적었습니다: ${row.heard}`);
  }

  function download() {
    const payload = {
      description:
        "음성 코퍼스. 오디오는 담지 않는다 — 무엇을 읽으라고 했고 무엇으로 적혔는지의 " +
        "문자열 쌍뿐이다 (기획안 §11.2).",
      protocol: "docs/음성코퍼스-프로토콜.md",
      collectedAt: new Date().toISOString().slice(0, 10),
      engine: "web-speech ko-KR",
      rows,
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "stt-corpus.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const failed = rows.filter((row) => row.error !== undefined || row.heard.length === 0).length;
  const exact = rows.filter((row) => row.heard === row.intended).length;
  const current = PROMPTS[index];

  return (
    <div style={{ padding: 24, maxWidth: 760, margin: "0 auto", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 22 }}>음성 코퍼스 수집 (개발 전용)</h1>
      <p style={{ color: "#555" }}>
        오디오는 저장하지 않습니다. 남는 것은 <b>읽으라고 한 말</b>과{" "}
        <b>인식기가 적은 말</b>의 짝뿐입니다.
      </p>

      <fieldset style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16 }}>
        <legend>어디서 얻는가</legend>
        {(Object.keys(SOURCE_LABEL) as Source[]).map((value) => (
          <label key={value} style={{ marginRight: 16 }}>
            <input
              type="radio"
              name="source"
              value={value}
              checked={source === value}
              disabled={running}
              onChange={() => setSource(value)}
            />{" "}
            {SOURCE_LABEL[value]}
          </label>
        ))}

        {source === "tts-synthetic" ? (
          <div style={{ marginTop: 12 }}>
            <label>
              목소리{" "}
              <select
                value={voiceName}
                disabled={running}
                onChange={(event) => setVoiceName(event.target.value)}
              >
                {korean.length === 0 ? <option value="">한국어 목소리 없음</option> : null}
                {korean.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </label>{" "}
            <label>
              속도 {rate.toFixed(2)}{" "}
              <input
                type="range"
                min={0.6}
                max={1.4}
                step={0.05}
                value={rate}
                disabled={running}
                onChange={(event) => setRate(Number(event.target.value))}
              />
            </label>
            <p style={{ color: "#a00", fontSize: 13 }}>
              스피커로 나간 소리를 마이크가 받아야 합니다. 인식이 계속 비면 시스템 루프백
              (Windows <code>Stereo Mix</code>, VB-Audio Cable 등)을 기본 입력으로 잡으세요.
            </p>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <label>
              화자 id (익명 별칭){" "}
              <input
                value={speaker}
                disabled={running}
                placeholder="예: A73"
                onChange={(event) => setSpeaker(event.target.value)}
              />
            </label>
            <p style={{ color: "#555", fontSize: 13 }}>
              본인이 아닌 분의 발화를 모을 때는 <b>무엇을 왜 모으는지 알리고 동의를 받은 뒤</b>{" "}
              진행하세요. 이름 대신 별칭만 남습니다.
            </p>
          </div>
        )}
      </fieldset>

      <fieldset style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16, marginTop: 12 }}>
        <legend>인식기에 무엇을 알려 줄까 (M22)</legend>
        <label style={{ marginRight: 16 }}>
          <input
            type="checkbox"
            checked={bias}
            disabled={running}
            onChange={(event) => setBias(event.target.checked)}
          />{" "}
          카탈로그를 알려 준다 (문맥 편향)
        </label>
        <label>
          <input
            type="checkbox"
            checked={wantLocal}
            disabled={running}
            onChange={(event) => setWantLocal(event.target.checked)}
          />{" "}
          기기 안에서 인식 (언어팩 있을 때만)
        </label>
        <p style={{ color: "#555", fontSize: 13, margin: "8px 0 0" }}>
          이 브라우저: {support}
        </p>
        <p style={{ color: "#a00", fontSize: 13, margin: "4px 0 0" }}>
          <b>같은 문장을 켜고 한 번, 끄고 한 번</b> 읽어야 비교가 됩니다. 한 번에 하나만 바꾸세요.
        </p>
      </fieldset>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16 }}>
          {index + 1} / {PROMPTS.length}
        </h2>
        <p style={{ fontSize: 28, fontWeight: 700, margin: "8px 0" }}>{current?.text}</p>
        <p style={{ color: "#555", minHeight: 24 }}>
          {heard.length > 0 ? `들린 말: ${heard}` : status}
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={captureOne} disabled={running}>
            한 문장 받기
          </button>
          <button type="button" onClick={runAll} disabled={running}>
            여기서부터 끝까지
          </button>
          <button
            type="button"
            onClick={() => {
              stopped.current = true;
              stt.stop();
              window.speechSynthesis.cancel();
            }}
            disabled={!running}
          >
            멈추기
          </button>
          <button type="button" onClick={() => setIndex((v) => Math.max(0, v - 1))} disabled={running}>
            이전
          </button>
          <button
            type="button"
            onClick={() => setIndex((v) => Math.min(PROMPTS.length - 1, v + 1))}
            disabled={running}
          >
            건너뛰기
          </button>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16 }}>모은 것</h2>
        <p>
          {rows.length}줄 · 그대로 적힌 것 {exact} · 인식 실패 {failed}
          {" · "}편향 {rows.filter((r) => r.bias).length}
          {" · "}기기 안 {rows.filter((r) => r.local === true).length}
        </p>
        <button type="button" onClick={download} disabled={rows.length === 0}>
          stt-corpus.json 내려받기
        </button>
        <p style={{ color: "#555", fontSize: 13 }}>
          내려받아 <code>tools/fixtures/stt-corpus.json</code>에 두고{" "}
          <code>pnpm --filter tools fit:confusion</code>을 돌립니다.
        </p>

        <ul style={{ maxHeight: 260, overflow: "auto", fontFamily: "monospace", fontSize: 12 }}>
          {rows
            .slice(-40)
            .reverse()
            .map((row, position) => (
              <li key={`${row.promptId}-${position}`}>
                {row.intended} → {row.error ? `(${row.error})` : row.heard}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
