import {
  groupByPath,
  headingText,
  type MenuCatalog,
  type MenuId,
  type SearchCandidate,
  type VoiceAction,
} from "@minui/core";
import { useEffect, useId, useRef, useState } from "react";
import { useMinUI } from "./useMinUI.js";

export interface SttLike {
  readonly isSupported: boolean;
  start(): Promise<void>;
  stop(): void;
  /**
   * 말이 끝났음을 알린다. **스트리밍이 아닌 엔진에만 있다.**
   *
   * <p>Web Speech는 말이 끊기면 스스로 확정하지만, 온디바이스 Whisper는 말이 끝나야
   * 옮기기 시작하므로 끝을 누가 알려 줘야 한다. 있으면 화면이 끝내는 버튼을 만들고,
   * 없으면 지금까지처럼 저절로 끝나기를 기다린다.
   */
  finish?(): void | Promise<void>;
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
  const { engine, assist } = useMinUI();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
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

  /**
   * 온디바이스로 먼저 찾고, 못 찾으면 도우미에게 묻는다.
   *
   * <p>순서가 중요하다. `"계좌이체"`처럼 이름을 아는 질의는 여기서 끝나므로 도우미를
   * 부르지 않는다 — 실측에서 정답 있는 질의의 15%만 도우미까지 갔다.
   * 도우미가 없거나 `null`을 돌려주면 원래대로 되묻는다.
   */
  function runTextSearch(query: string) {
    if (query.trim().length === 0) return;
    setNotice(null);

    const action = engine.voiceAction(query);
    if (action.kind !== "reprompt" || !assist) {
      apply(action);
      return;
    }

    // 되묻기 화면을 먼저 띄워 둔다. 도우미가 늦어도 사용자가 멈춰 있지 않게.
    apply(action);
    setAsking(true);

    // 관련도 순 후보. 카탈로그 순서로 자르면 아무 관계 없는 메뉴가 후보가 된다.
    void assist(query, engine.candidates(query))
      .then((menuId) => {
        if (!menuId) return;
        const menu = engine.getMenu(menuId);
        if (!menu) return;
        /*
         * 도우미가 골라도 **바로 열지 않는다.** 후보로 보여 주고 사용자가 누른다.
         * `riskLevel: high`는 §9.3이 자동 실행을 막고, 낮은 것도 도우미의 판단이라
         * 한 번 확인받는 편이 맞다 — 틀린 화면이 저절로 열리는 것이 되묻기보다 나쁘다.
         */
        setPhase({
          kind: "candidates",
          candidates: [{ menuId, score: 0, matchedBy: "semantic", matchedTerm: query }],
        });
      })
      .catch(() => {
        // 도우미가 죽어도 서비스는 돈다. 되묻기 화면이 이미 떠 있다.
      })
      .finally(() => setAsking(false));
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

  /**
   * 말이 끝났다고 알린다.
   *
   * <p>온디바이스 모델은 여기서부터 옮기기 시작한다 — 짧지 않은 시간이 걸리므로
   * 무엇이 일어나는지 글자로 알린다. 침묵은 고장으로 읽힌다.
   */
  async function finishListening() {
    if (!stt?.finish) return;
    setPhase({ kind: "idle" });
    setNotice("들은 말을 옮기는 중이에요…");
    try {
      await stt.finish();
    } finally {
      setNotice((current) =>
        current === "들은 말을 옮기는 중이에요…" ? null : current,
      );
    }
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
            onClick={() =>
              void (phase.kind === "listening" && stt?.finish
                ? finishListening()
                : startListening())
            }
          >
            <span aria-hidden="true">🎤</span>
            {phase.kind !== "listening"
              ? "눌러서 말하기"
              : /*
                 * 스스로 끝나는 엔진에서는 누를 것이 없으므로 상태만 알린다.
                 * 끝을 알려야 하는 엔진에서는 무엇을 해야 하는지 글자로 말한다 —
                 * "듣고 있어요"만 떠 있으면 사용자는 계속 기다린다.
                 */
                stt?.finish
                ? "다 말했어요"
                : "듣고 있어요"}
          </button>
        )}

        {/* 마이크가 열려 있다는 것을 글자로도 알린다 (기획안 §11.2). */}
        <p className="minui-status" role="status">
          {phase.kind === "listening"
            ? phase.heard
              ? `"${phase.heard}"`
              : "말씀해 주세요"
            : asking
              ? "찾아보는 중이에요…"
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
                      {/*
                        **무엇인지**와 **어디 있는지**는 다른 정보라 둘 다 준다.
                        뜻풀이는 `예수금` 같은 말이 뭔지 모를 때, 경로는 후보 이름이
                        서로 닮았을 때(`펀드검색` / `세제혜택펀드검색`) 필요하다.
                        후보는 최대 3개뿐이라 두 줄을 감당할 수 있다 — 전체 메뉴와
                        다른 판단이다.
                      */}
                      {menu.hint && (
                        <span className="minui-candidate-hint">{menu.hint}</span>
                      )}
                      <span className="minui-candidate-why">
                        {headingText(menu.path?.join(">") ?? "") || menu.category}
                      </span>
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
            {/*
              한 갈래가 수백 개일 수 있다(신한 `개인` 아래 400개 넘음). 평평하게 쏟으면
              되묻기를 없애려던 화면이 다시 탐색 문제가 된다 — 상위메뉴로 묶어 보여 준다.
            */}
            {groupByPath(
              catalog.filter((menu) => menu.category === phase.name),
              catalog,
            ).map((group) => (
              <div key={group.heading}>
                {group.heading !== "" && (
                  <p className="minui-subgroup-name">{headingText(group.heading)}</p>
                )}
                <ul className="minui-group-list">
                  {group.menus.map((menu) => (
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
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
