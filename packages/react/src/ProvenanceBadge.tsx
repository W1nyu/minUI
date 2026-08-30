/**
 * 이 설명이 **어디서 왔는가** (AI-8).
 *
 * <p>AI를 자랑하는 배지가 아니라 <b>"이건 AI가 아니다"를 말할 수 있게 하는</b> 배지다.
 * 이 저장소에서 화면에 뜨는 설명의 대부분은 모델이 만든 것이 아니다 — 카탈로그에 있던
 * 것, 빌드 때 구워 둔 것, 공개 안내문을 읽고 쓴 것이다. 그 셋과 모델이 방금 쓴 것을
 * 같은 모양으로 그리면, 사용자는 전부 AI가 지어낸 것으로 보거나 전부 사실로 본다.
 * 어느 쪽이든 틀렸다.
 *
 * <p>모델 이름을 함께 적는다. "AI가 도왔다"까지만 말하고 어느 AI인지 숨기면, 답이
 * 이상할 때 무엇을 의심해야 하는지 알 수 없다. <b>모델 이름은 비밀이 아니다 — 키가
 * 비밀이다.</b>
 */

export type HintProvenance =
  /** 카탈로그에 원래 있던 뜻풀이 */
  | "catalog"
  /** 배포에 담아 온 미리 구운 답 */
  | "cache"
  /** 공개 안내문을 읽고 쓴 답. 인용이 함께 붙는다 */
  | "grounded"
  /** 방금 모델이 쓴 답 */
  | "ai";

export interface ProvenanceBadgeProps {
  provenance: HintProvenance;
  /** `ai`일 때 어느 모델이었는지. 없으면 이름 없이 "AI 도우미"까지만. */
  model?: string | undefined;
}

const TEXT: Record<HintProvenance, string> = {
  catalog: "이 기기에 있는 설명",
  cache: "미리 준비한 설명",
  grounded: "공식 안내문을 읽은 설명",
  ai: "AI 도우미가 쓴 설명",
};

export function ProvenanceBadge({ provenance, model }: ProvenanceBadgeProps) {
  return (
    <span className="minui-provenance" data-provenance={provenance}>
      {TEXT[provenance]}
      {/*
        모델 이름은 괄호로 뒤에 붙인다. 배지의 첫 낱말이 언제나 같은 자리에 오도록 —
        훑어 읽는 사람에게는 "AI"인지 아닌지가 먼저 보여야 하고, 어느 모델인지는
        궁금할 때 읽는 것이다.
      */}
      {provenance === "ai" && model ? ` (${model})` : ""}
    </span>
  );
}
