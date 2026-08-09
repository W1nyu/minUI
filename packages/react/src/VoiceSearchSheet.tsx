import type { MenuCatalog, MenuId, SearchCandidate, VoiceAction } from "@minui/core";
import { useEffect, useId, useRef, useState } from "react";
import { useMinUI } from "./useMinUI.js";

export interface SttLike {
  readonly isSupported: boolean;
  start(): Promise<void>;
  stop(): void;
  onPartial(callback: (text: string) => void): () => void;
  onFinal(callback: (result: { text: string; confidence: number }) => void): () => void;
  onError(callback: (error: { code: string; message: string }) => void): () => void;
}

export interface VoiceSearchSheetProps {
  catalog: MenuCatalog;
  onClose: () => void;
  onSelect: (menuId: MenuId) => void;
  /** `@minui/voice`의 SttProvider. 없으면 텍스트 검색만 노출한다. */
  stt?: SttLike;
}

type Phase =
  | { kind: "idle" }
  | { kind: "listening"; heard: string }
  | { kind: "candidates"; candidates: SearchCandidate[] }
  | { kind: "reprompt"; prompt: string; choices: string[] }
  /** 되묻기에서 카테고리를 고른 뒤. 그 카테고리의 메뉴를 그대로 보여 준다. */
  | { kind: "category"; name: string };

/**
 * 말로 찾기 (기획안 F4 / §9.2).
 *
 * 지켜야 하는 것 세 가지가 화면 구조를 정한다.
 *   - 후보는 **큰 버튼으로** 최대 3개. 자동 실행하지 않고 사용자가 고른다.
 *   - 인식 실패는 막다른 길이 아니다. 되묻기 문구와 함께 다른 길을 함께 준다.
 *   - 마이크는 버튼을 누른 동안만 열리고, 열린 상태가 화면에 분명히 보인다 (§11.2).
 *
 * 음성을 못 쓰는 환경(권한 거부, 미지원 브라우저)에서도 이 화면은 그대로 쓸모 있다.
 * 텍스트 입력이 언제나 동등한 대안으로 있기 때문이다 — 음성은 보조 경로이지
 * 유일 경로가 아니다 (기획안 §14 리스크 대응).
 */
export function VoiceSearchSheet({
  catalog,
  onClose,
  onSelect,
  stt,
}: VoiceSearchSheetProps) {
  const { engine } = useMinUI();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const inputId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const byId = new Map(catalog.map((menu) => [menu.id, menu]));
  const voiceAvailable = stt?.isSupported === true;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function apply(action: VoiceAction) {
    switch (action.kind) {
      case "open":
        onSelect(action.menuId);
        return;
      case "choose":
        setPhase({ kind: "candidates", candidates: action.candidates });
        return;
      case "reprompt":
        setPhase({ kind: "reprompt", prompt: action.prompt, choices: action.choices });
        return;
    }
  }

  function runTextSearch(query: string) {
    if (query.trim().length === 0) return;
    setNotice(null);
    apply(engine.voiceAction(query));
  }

  useEffect(() => {
    if (!stt) return;

    const unsubscribers = [
      stt.onPartial((heard) => setPhase({ kind: "listening", heard })),
      stt.onFinal((result) => {
        stt.stop();
        setText(result.text);
        apply(engine.voiceAction(result.text, result.confidence));
      }),
      stt.onError((error) => {
        stt.stop();
        setPhase({ kind: "idle" });
        setNotice(
          error.code === "permission-denied"
            ? "마이크를 쓸 수 없습니다. 아래에 글로 입력해 주세요."
            : "잘 들리지 않았습니다. 다시 말씀하시거나 글로 입력해 주세요.",
        );
      }),
    ];

    return () => {
      for (const off of unsubscribers) off();
      stt.stop();
    };
    // engine은 세션 동안 고정이다.
  }, [stt, engine]);

  async function startListening() {
    if (!stt) return;
    setNotice(null);
    setPhase({ kind: "listening", heard: "" });
    await stt.start();
  }

  return (
    <div
      className="minui-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="minui-voice-title"
    >
      <div className="minui-sheet-header">
        <h2 className="minui-sheet-title" id="minui-voice-title">
          말로 찾기
        </h2>
        <button
          type="button"
          className="minui-sheet-close"
          onClick={onClose}
          ref={closeRef}
        >
          <span aria-hidden="true">←</span> 돌아가기
        </button>
      </div>

      <div className="minui-sheet-body">
        {voiceAvailable && (
          <button
            type="button"
            className="minui-mic"
            data-listening={phase.kind === "listening"}
            onClick={() => void startListening()}
          >
            <span aria-hidden="true">🎤</span>
            {phase.kind === "listening" ? "듣고 있어요" : "눌러서 말하기"}
          </button>
        )}

        {/* 마이크가 열려 있다는 것을 글자로도 알린다 (기획안 §11.2). */}
        <p className="minui-status" role="status">
          {phase.kind === "listening"
            ? phase.heard
              ? `"${phase.heard}"`
              : "말씀해 주세요"
            : notice}
        </p>

        <form
          className="minui-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            runTextSearch(text);
          }}
        >
          <label className="minui-group-name" htmlFor={inputId}>
            글로 찾기
          </label>
          <div className="minui-search-row">
            <input
              id={inputId}
              className="minui-search-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="예: 자동이체"
            />
            <button type="submit" className="minui-search-submit">
              찾기
            </button>
          </div>
        </form>

        {phase.kind === "candidates" && (
          <section className="minui-group" aria-label="찾은 메뉴">
            <h3 className="minui-group-name">이거 말씀하신 건가요?</h3>
            <ul className="minui-group-list">
              {phase.candidates.map((candidate) => {
                const menu = byId.get(candidate.menuId);
                if (!menu) return null;
                return (
                  <li key={candidate.menuId}>
                    <button
                      type="button"
                      className="minui-candidate"
                      onClick={() => onSelect(candidate.menuId)}
                    >
                      <span className="minui-candidate-label">{menu.label}</span>
                      <span className="minui-candidate-why">{menu.category}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {phase.kind === "reprompt" && (
          <section className="minui-group" aria-label="다시 찾기">
            {/* 막다른 길을 만들지 않는다 — 되묻되 고를 것을 함께 준다 (기획안 F4). */}
            <h3 className="minui-group-name">{phase.prompt}</h3>
            <ul className="minui-group-list">
              {phase.choices.map((choice) => (
                <li key={choice}>
                  <button
                    type="button"
                    className="minui-candidate"
                    /*
                     * 고른 카테고리로 **검색을 다시 돌리지 않는다.**
                     * 카테고리 이름은 검색어가 아니라서(MenuIndex가 일부러 제외한다)
                     * 다시 돌리면 같은 되묻기로 돌아온다 — 막다른 길을 없애려던 화면이
                     * 스스로 막다른 길이 되는 셈이다. 대신 그 갈래의 메뉴를 바로 보여 준다.
                     */
                    onClick={() => setPhase({ kind: "category", name: choice })}
                  >
                    <span className="minui-candidate-label">{choice}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {phase.kind === "category" && (
          <section className="minui-group" aria-label="찾은 메뉴">
            <h3 className="minui-group-name">{phase.name}</h3>
            <ul className="minui-group-list">
              {catalog
                .filter((menu) => menu.category === phase.name)
                .map((menu) => (
                  <li key={menu.id}>
                    <button
                      type="button"
                      className="minui-candidate"
                      onClick={() => onSelect(menu.id)}
                    >
                      <span className="minui-candidate-label">{menu.label}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
