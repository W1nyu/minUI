import { useEffect, useMemo, useRef, useState } from "react";
import { FEEDBACK_TOPICS, formatFeedback, type FeedbackTopic } from "./feedback.js";

export interface FeedbackSheetProps {
  releaseId: string;
  onClose: () => void;
}

/**
 * 배포 뒤 개선 재료를 받는 가벼운 의견 봉투.
 *
 * <p>GitHub Pages 데모는 의견을 받을 서버가 없고, 금융 맥락을 임의의 폼 서비스로
 * 보내는 것도 맞지 않는다. 따라서 이 시트는 내용을 저장하거나 전송하지 않는다.
 * 사용자가 한 번 더 읽고 복사하는 행위가 동의이며, 그 뒤 전달할 채널은 사용자가 고른다.
 */
export function FeedbackSheet({ releaseId, onClose }: FeedbackSheetProps) {
  const [topic, setTopic] = useState<FeedbackTopic | null>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "unavailable">("idle");
  const closeRef = useRef<HTMLButtonElement>(null);
  const report = useMemo(
    () => (topic ? formatFeedback({ topic, releaseId }) : ""),
    [releaseId, topic],
  );

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

  async function copy() {
    if (!topic) return;
    try {
      await navigator.clipboard.writeText(report);
      setStatus("copied");
    } catch {
      // 클립보드를 막는 브라우저에서도 아래 읽기 전용 봉투를 길게 눌러 복사할 수 있다.
      setStatus("unavailable");
    }
  }

  return (
    <div className="screen feedback-sheet" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <header className="screen-header">
        <button type="button" className="screen-back" onClick={onClose} ref={closeRef}>
          <span aria-hidden="true">←</span> 돌아가기
        </button>
        <h2 id="feedback-title">의견 남기기</h2>
      </header>

      <div className="screen-body feedback-body">
        <p className="feedback-lead">
          이 내용은 자동으로 저장하거나 보내지 않아요. 복사한 뒤 원하실 때만 전달해 주세요.
        </p>

        <section className="feedback-section" aria-label="의견 종류">
          <h3>어떤 점이었나요?</h3>
          <div className="feedback-topics" role="group" aria-label="의견 종류 고르기">
            {FEEDBACK_TOPICS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={topic === entry.id}
                onClick={() => {
                  setTopic(entry.id);
                  setStatus("idle");
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </section>

        {topic && (
          <section className="feedback-section" aria-label="복사할 의견">
            <h3>전달할 내용</h3>
            <pre className="feedback-preview">{report}</pre>
            <button
              type="button"
              className="primary-button"
              onClick={() => void copy()}
            >
              의견 복사하기
            </button>
            <p className="field-note" role="status">
              {status === "copied" && "복사됐어요. 원하시는 피드백 창에 붙여 넣어 주세요."}
              {status === "unavailable" && "자동 복사가 안 돼요. 위 내용을 길게 눌러 복사해 주세요."}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
