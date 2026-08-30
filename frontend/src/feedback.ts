/**
 * 공개 데모에서 받은 의견의 최소 형식.
 *
 * <p>서버로 보내거나 기기에 저장하지 않는다. 사용자가 내용을 보고 복사한 뒤 원하는
 * 피드백 채널로 직접 전달할 때만 기기 밖으로 나간다. 금융 데모에서 "나중에 분석할지도"
 * 모른다는 이유로 검색어·계좌·금액을 모으지 않기 위한 경계다.
 */
export const FEEDBACK_TOPICS = [
  { id: "find", label: "찾고 싶은 기능을 못 찾았어요" },
  { id: "explain", label: "설명이 어렵거나 부족했어요" },
  { id: "home", label: "첫 화면이 제게 맞지 않았어요" },
  { id: "flow", label: "다음에 무엇을 눌러야 할지 몰랐어요" },
  { id: "good", label: "도움이 됐어요" },
] as const;

export type FeedbackTopic = (typeof FEEDBACK_TOPICS)[number]["id"];

export interface FeedbackDraft {
  topic: FeedbackTopic;
  releaseId: string;
}

/** 사람이 검토해 복사할 수 있는, 목적이 좁은 피드백 봉투. */
export function formatFeedback(draft: FeedbackDraft): string {
  const topic = FEEDBACK_TOPICS.find((entry) => entry.id === draft.topic)?.label ?? draft.topic;

  return [
    "[MinUI 공개 데모 의견]",
    `배포본: ${draft.releaseId}`,
    `분류: ${topic}`,
    "개인 금융정보·검색어·음성 원문은 포함하지 않았습니다.",
  ].join("\n");
}
