import {
  groupByPath,
  headingText,
  type RepromptChoice,
  type MenuCatalog,
  type MenuId,
  type SearchCandidate,
  type VoiceAction,
} from "@minui/core";
import { useEffect, useId, useRef, useState } from "react";
import { ProvenanceBadge } from "./ProvenanceBadge.js";
import { useMinUI } from "./useMinUI.js";
import type { MinUIInteraction } from "./interaction.js";

export interface SttLike {
  readonly isSupported: boolean;
  start(): Promise<void>;
  stop(): void;
  /**
   * 말이 끝났음을 사용자가 직접 알린다. **선택 계약이다.**
   *
   * <p>있으면 화면이 끝내는 버튼을 만들고, 없으면 저절로 끝나기를 기다린다.
   *
   * <p>처음에는 스스로 끝나지 못하는 엔진(온디바이스 Whisper)을 위한 손잡이였는데,
   * 남긴 이유는 <b>사람 쪽</b>에 있다. 스스로 끝나는 엔진에서도 조용히 말하거나 말끝을
   * 흐리면 인식기가 끊을 때까지 기다려야 하고, <b>고령 사용자가 정확히 그렇게 말한다</b>
   * (기획안 §9.2). 끝을 본인이 정할 수 있으면 그 기다림이 사라진다.
   */
  finish?(): void | Promise<void>;
  onPartial(callback: (text: string) => void): () => void;
  onFinal(callback: (result: { text: string; confidence: number }) => void): () => void;
  onError(callback: (error: { code: string; message: string }) => void): () => void;
}

export interface VoiceSearchSheetProps {
  catalog: MenuCatalog;
  onClose: () => void;
  /**
   * 사용자가 고른 메뉴. **미리 채울 값이 함께 온다** (M9).
   *
   * <p>값을 만드는 것은 호스트가 엔진에 준 추출기이고, 그것이 없으면 두 번째 인자가
   * 비어 있을 뿐이다. 화면을 여는 것은 지금까지처럼 호스트다.
   */
  onSelect: (menuId: MenuId, prefill?: Record<string, unknown>) => void;
  /** `@minui/voice`의 SttProvider. 없으면 텍스트 검색만 노출한다. */
  stt?: SttLike;
  /** 호스트가 요청한 경우에만 음성 대기 시간을 요약해 알린다. */
  onInteraction?: (interaction: MinUIInteraction) => void;
  /** 되묻기로도 못 좁혔을 때, 전체 메뉴라는 탈출구를 호스트가 열어 준다. */
  onBrowseAll?: () => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "listening"; heard: string }
  | { kind: "candidates"; candidates: SearchCandidate[] }
  | { kind: "reprompt"; prompt: string; choices: RepromptChoice[] }
  /** 되묻기에서 카테고리를 고른 뒤. 그 카테고리의 메뉴를 그대로 보여 준다. */
  /**
   * 되묻기에서 선택지를 고른 뒤.
   *
   * <p>**`menuIds`를 함께 들고 온다** (M11). 전에는 이름만 들고 와서 화면이 그 이름으로
   * 카탈로그를 다시 걸렀는데, 이제 선택지가 갈래 조각일 수 있어 그렇게 하면 아무것도
   * 안 나온다. 무엇을 보여 줄지는 고른 쪽이 안다.
   */
  | { kind: "category"; name: string; menuIds: MenuId[] };

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
  onInteraction,
  onBrowseAll,
}: VoiceSearchSheetProps) {
  const { engine, assist, clarify, correct } = useMinUI();
  /**
   * 도우미가 낸 제안. **검증을 지난 것만 여기 온다** (AI-9).
   *
   * <p>후보 목록과 따로 들고 있는 이유: 후보는 로컬 검색도 만들고 도우미도 만드는데,
   * <b>어느 쪽이 만든 것인지</b>를 화면이 말해야 하기 때문이다. 돈이 오가는 앱에서
   * 모델이 내민 것을 검색 결과와 똑같이 그리면 사용자는 그것이 추측인 줄 모른다.
   */
  const [aiProposal, setAiProposal] = useState<{
    menuId: MenuId;
    why?: string | undefined;
    model?: string | undefined;
    dropped?: string | undefined;
  } | null>(null);
  /**
   * 잘못 들은 말을 고쳐 다시 찾았을 때, **무엇으로 고쳐 들었는지** (AI-6).
   *
   * <p>화면에 보여 주는 것이 이 기능의 절반이다. 고친 말을 숨기고 결과만 바꾸면
   * 사용자는 자기가 한 말과 다른 답을 보고 앱이 제멋대로 골랐다고 읽는다.
   */
  const [heardAs, setHeardAs] = useState<{ query: string; model?: string | undefined } | null>(
    null,
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const inputId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const listeningStartedAt = useRef<number | null>(null);

  const byId = new Map(catalog.map((menu) => [menu.id, menu]));
  const voiceAvailable = stt?.isSupported === true;

  /**
   * 이 말로 찾다가 이 메뉴를 골랐다 — **개인 동의어 학습의 유일한 입구다** (M7).
   *
   * <p>이 화면을 거친 선택만 학습 신호가 된다. 카드나 전체 메뉴에서 연 것은 그 질의가
   * 그 메뉴를 뜻한다는 근거가 아니기 때문이다. 되묻기에서 갈래를 타고 들어가 고른 것도
   * 여기로 온다 — 검색이 못 알아들었지만 사용자가 끝내 도달한 경우이므로,
   * 오히려 가장 배울 값이 있는 신호다.
   *
   * <p>`query`를 따로 받는 이유: 음성 인식이 끝난 <b>그 순간</b>에는 `setText`가 아직
   * 반영되지 않아 `text`가 직전 값이다. 버튼으로 고를 때는 이미 반영돼 있으므로
   * 기본값이 맞다.
   */
  function choose(menuId: MenuId, query: string = text) {
    engine.noteSearchChoice(query, menuId);
    /*
     * 미리 채울 값은 **고른 뒤에** 묻는다 (M9). 후보가 셋일 때는 어느 것을 고를지
     * 모르므로 값도 정해지지 않는다 — `voiceAction`이 후보 제시에 프리필을 붙이지 않는
     * 이유가 그것이다.
     */
    const prefill = engine.prefillFor(query, menuId);
    onSelect(menuId, Object.keys(prefill).length > 0 ? prefill : undefined);
  }

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

  function apply(action: VoiceAction, query: string) {
    switch (action.kind) {
      case "open":
        choose(action.menuId, query);
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
   * 온디바이스 → 원격 신경망 → 도우미. **세 겹이고 위의 둘은 없어도 된다.**
   *
   * <p>순서가 중요하다. `"계좌이체"`처럼 이름을 아는 질의는 첫 겹에서 끝나므로 아래를
   * 부르지 않는다 — 실측에서 정답 있는 질의의 15%만 도우미까지 갔다. 위 두 겹이 없거나
   * 죽거나 늦으면 원래대로 되묻는다.
   *
   * <p>두 번째 겹(M11)이 세 번째와 다른 일을 한다. 도우미는 <b>이미 가진 후보 중</b>
   * 하나를 고르고, 원격 검색은 <b>로컬이 0점을 준 메뉴를 데려온다.</b> 그래서 원격이
   * 앞이다 — 후보를 늘려 놓아야 도우미가 고를 것도 는다.
   */
  async function runTextSearch(query: string) {
    if (query.trim().length === 0) return;
    setNotice(null);
    // 지난 검색에서 고쳐 들은 말이 새 검색 결과 위에 남아 있으면 안 된다.
    setHeardAs(null);
    setAiProposal(null);

    /*
     * 로컬 결과를 먼저 그린다. 원격을 기다리는 동안 화면이 비어 있으면 사용자는
     * 고장으로 읽는다 — 아래 도우미 단계가 되묻기를 먼저 띄우는 것과 같은 이유다.
     */
    const localAction = engine.voiceAction(query);
    if (localAction.kind === "reprompt") apply(localAction, query);

    const action = await engine.voiceActionWithRetrieval(query);
    if (action.kind !== "reprompt" || !assist) {
      apply(action, query);
      return;
    }

    // 되묻기 화면을 먼저 띄워 둔다. 도우미가 늦어도 사용자가 멈춰 있지 않게.
    apply(action, query);
    setAsking(true);

    /*
     * **한 문장 되묻기** (AI-3). 화면에 이미 뜬 갈래를 그대로 넘기고, 모델은 그중 둘을
     * 고르고 질문 한 줄을 쓴다. 갈래를 만들지 못하므로 없는 것이 뜰 수가 없다.
     *
     * 도우미(`assist`)와 나란히 달린다. 도우미가 답을 찾으면 후보 화면이 이것을 덮고,
     * 못 찾으면 이쪽이 되묻기를 조금 더 친절하게 만든다. 둘 다 실패해도 갈래 되묻기가
     * 이미 화면에 있다 — **어느 경우에도 빈 화면이 없다.**
     */
    /*
     * **말을 고쳐 다시 찾아 본다** (AI-6).
     *
     * 도우미(`assist`)·되묻기(`clarify`)와 나란히 달리되 하는 일이 다르다 — 이것은
     * 목적지를 고르지 않고 <b>질의만</b> 고친다. 고쳐진 말은 `engine.voiceAction`을
     * 그대로 지나므로 배운 말·자모 보정·§9.3의 위험도 경계가 전부 살아 있다.
     *
     * 셋 중 무엇이 먼저 답하든 화면에는 이미 갈래 되묻기가 떠 있다 — **어느 경우에도
     * 빈 화면이 없다.**
     */
    if (correct) {
      void correct(query, engine.candidates(query))
        .then((fixed) => {
          if (!fixed) return;
          const retried = engine.voiceAction(fixed.query);
          // 고쳐도 여전히 못 찾으면 조용히 접는다. 되묻기가 이미 답이다.
          if (retried.kind === "reprompt") return;
          setHeardAs(fixed);
          apply(retried, fixed.query);
        })
        .catch(() => {
          // 되묻기 화면이 이미 떠 있다. 아무것도 하지 않는다.
        });
    }

    if (clarify) {
      void clarify(query, action.choices.map((choice) => ({ label: choice.label })))
        .then((clarification) => {
          if (!clarification) return;
          const byLabel = new Map(action.choices.map((choice) => [choice.label, choice]));
          const picked = clarification.branches.flatMap((branch) => {
            const choice = byLabel.get(branch.label);
            return choice ? [choice] : [];
          });
          if (picked.length !== clarification.branches.length) return;
          /*
           * **되묻기는 더 나은 답을 덮지 않는다.**
           *
           * 셋이 나란히 달리므로(도우미·되묻기·교정) 늦게 오는 것이 먼저 온 것을
           * 덮을 수 있다. 실제로 그랬다 — 교정이 메뉴를 찾아 후보를 띄운 화면을
           * 되묻기가 다시 "어느 쪽인가요?"로 되돌렸다. 되묻기는 <b>아직 못 찾은
           * 상태일 때만</b> 말을 보탠다.
           */
          setPhase((previous) =>
            previous.kind === "reprompt"
              ? { kind: "reprompt", prompt: clarification.question, choices: picked }
              : previous,
          );
        })
        .catch(() => {
          // 되묻기 화면이 이미 떠 있다. 아무것도 하지 않는다.
        });
    }

    // 관련도 순 후보. 카탈로그 순서로 자르면 아무 관계 없는 메뉴가 후보가 된다.
    void assist(query, engine.candidates(query))
      .then((answer) => {
        if (!answer) return;
        // 호스트가 id만 돌려줘도 받는다. 계약을 넓히되 기존 호스트를 깨지 않는다.
        const proposal = typeof answer === "string" ? { menuId: answer } : answer;
        const menu = engine.getMenu(proposal.menuId);
        if (!menu) return;
        setAiProposal(proposal);
        /*
         * 도우미가 골라도 **바로 열지 않는다.** 후보로 보여 주고 사용자가 누른다.
         * `riskLevel: high`는 §9.3이 자동 실행을 막고, 낮은 것도 도우미의 판단이라
         * 한 번 확인받는 편이 맞다 — 틀린 화면이 저절로 열리는 것이 되묻기보다 나쁘다.
         */
        setPhase({
          kind: "candidates",
          candidates: [
            { menuId: proposal.menuId, score: 0, matchedBy: "semantic", matchedTerm: query },
          ],
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
        const started = listeningStartedAt.current;
        listeningStartedAt.current = null;
        if (started !== null) {
          const current = typeof performance !== "undefined" ? performance.now() : Date.now();
          onInteraction?.({ kind: "voice", durationMs: current - started });
        }
        stt.stop();
        setText(result.text);
        /*
         * 음성도 원격까지 묻는다 (M11). 글로 친 것과 말한 것이 같은 답을 받아야 한다 —
         * 다르면 사용자가 "말로는 안 되는데 쳐야 된다"를 배운다.
         *
         * **도우미(`assist`)는 여기서 부르지 않는다.** 지금까지 그랬고, 그 판단을 M11이
         * 바꾸지 않는다. 음성은 신뢰도가 함께 오고 §9.2가 그 값으로 되묻기를 정하는데,
         * 도우미를 끼우면 그 경로가 달라진다 — 재 보지 않고 바꿀 일이 아니다.
         */
        void engine
          .voiceActionWithRetrieval(result.text, result.confidence)
          .then((action) => apply(action, result.text));
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
  }, [stt, engine, onInteraction]);

  async function startListening() {
    if (!stt) return;
    listeningStartedAt.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    setNotice(null);
    setPhase({ kind: "listening", heard: "" });
    await stt.start();
  }

  /**
   * 말이 끝났다고 알린다.
   *
   * <p>엔진이 여기서부터 확정한다 — 즉시 끝나지 않을 수 있으므로 무엇이 일어나는지
   * 글자로 알린다. <b>침묵은 고장으로 읽힌다.</b>
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
                 * 끝내는 손잡이가 있으면 무엇을 해야 하는지 글자로 말한다 —
                 * "듣고 있어요"만 떠 있으면 사용자는 계속 기다린다.
                 * 손잡이가 없는 엔진에서는 누를 것이 없으므로 상태만 알린다.
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
            void runTextSearch(text);
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

        {/*
          **무엇으로 고쳐 들었는지 먼저 말한다** (AI-6). 결과보다 위에 두는 이유는,
          사용자가 자기 말과 다른 답을 보기 **전에** 왜 다른지 알아야 하기 때문이다.
        */}
        {heardAs && (
          <p className="minui-heard-as" role="status">
            <span className="minui-heard-as-mark">이렇게 들었어요</span>
            <span className="minui-heard-as-query">{heardAs.query}</span>
            <ProvenanceBadge provenance="ai" model={heardAs.model} />
          </p>
        )}

        {phase.kind === "candidates" && (
          <section className="minui-group" aria-label="찾은 메뉴">
            <h3 className="minui-group-name">이거 말씀하신 건가요?</h3>

            {/*
              **AI가 낸 것이면 그렇다고 말한다** (AI-9).

              화면에 뜨는 이름과 위험도는 모델의 것이 아니다 — `validateProposal`이
              카탈로그에서 다시 만든다. 모델이 정한 것은 <b>어느 것인지</b>와 <b>왜</b>
              한 줄뿐이고, 그 한 줄도 길이·숫자 검사를 지났다. 버린 것이 있으면 그것도
              적는다: 검증이 있다는 사실은 <b>버린 것을 보여 줄 때만</b> 사용자에게 보인다.
            */}
            {aiProposal &&
              phase.candidates.some((candidate) => candidate.menuId === aiProposal.menuId) && (
                <p className="minui-ai-proposal" role="note">
                  <span className="minui-ai-proposal-mark">
                    AI 제안 · 메뉴와 위험도는 확인함
                    {aiProposal.model ? ` (${aiProposal.model})` : ""}
                  </span>
                  {aiProposal.why && <span className="minui-ai-proposal-why">{aiProposal.why}</span>}
                  {aiProposal.dropped && (
                    <span className="minui-ai-proposal-dropped">
                      AI가 쓴 설명 한 줄은 버렸어요 — {aiProposal.dropped}
                    </span>
                  )}
                </p>
              )}
            <ul className="minui-group-list">
              {phase.candidates.map((candidate) => {
                const menu = byId.get(candidate.menuId);
                if (!menu) return null;
                return (
                  <li key={candidate.menuId}>
                    <button
                      type="button"
                      className="minui-candidate"
                      onClick={() => choose(candidate.menuId)}
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
                      {/*
                        **왜 이게 나왔는지**를 배운 말일 때만 적는다 (M8). 카탈로그에
                        원래 있던 말로 찾은 것은 사용자가 설명을 필요로 하지 않는다 —
                        모든 후보에 근거를 달면 그것이 다시 읽을 것이 되어 후보가
                        세 개뿐인 이 화면의 뜻이 사라진다.
                      */}
                      {candidate.matchedBy === "learned" && (
                        <span className="minui-candidate-learned">
                          전에 이렇게 찾으셨어요
                        </span>
                      )}
                      <span className="minui-candidate-why">
                        {headingText(menu.path?.join(">") ?? "") || menu.category}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {onBrowseAll && (
              <button type="button" className="minui-search-browse" onClick={onBrowseAll}>
                말 대신 전체 메뉴에서 직접 찾아볼래요
              </button>
            )}
          </section>
        )}

        {phase.kind === "reprompt" && (
          <section className="minui-group" aria-label="다시 찾기">
            {/* 막다른 길을 만들지 않는다 — 되묻되 고를 것을 함께 준다 (기획안 F4). */}
            <h3 className="minui-group-name">{phase.prompt}</h3>
            <ul className="minui-group-list">
              {phase.choices.map((choice) => (
                <li key={choice.label}>
                  <button
                    type="button"
                    className="minui-candidate"
                    /*
                     * 고른 카테고리로 **검색을 다시 돌리지 않는다.**
                     * 카테고리 이름은 검색어가 아니라서(MenuIndex가 일부러 제외한다)
                     * 다시 돌리면 같은 되묻기로 돌아온다 — 막다른 길을 없애려던 화면이
                     * 스스로 막다른 길이 되는 셈이다. 대신 그 갈래의 메뉴를 바로 보여 준다.
                     */
                    onClick={() =>
                      setPhase({ kind: "category", name: choice.label, menuIds: choice.menuIds })
                    }
                  >
                    <span className="minui-candidate-label">{choice.label}</span>
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
              /*
               * **고른 쪽이 준 목록을 그대로 쓴다** (M11). 이름으로 다시 거르지 않는다 —
               * 선택지가 갈래 조각(`이체`)일 수 있고 그것은 카테고리 이름이 아니다.
               */
              catalog.filter((menu) => phase.menuIds.includes(menu.id)),
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
                        onClick={() => choose(menu.id)}
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
