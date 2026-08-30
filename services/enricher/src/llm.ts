/**
 * 모델 하나를 부르는 계약 (AI-1).
 *
 * <p>**왜 인터페이스를 뽑았는가.** 무료 티어는 분당·일일 한도가 있고, 시연 도중에
 * 한도가 끊기면 기능이 죽는다 — 기획안 §14가 "공개 API 남용 | 시연 중 429로 기능 사망"을
 * 리스크로 적어 둔 그 자리다. `guard.ts`의 호출 제한·캐시가 <b>우리 쪽</b>을 막는 문이라면,
 * 이 인터페이스는 <b>저쪽이 막았을 때</b>의 답이다. 한 곳이 거절하면 다음 곳으로 간다.
 *
 * <p>계약이 좁은 것이 중요하다. `Gemini`가 이미 갖고 있던 모양(`json`) 그대로다 —
 * 프롬프트도 스키마도 재시도 정책도 바꾸지 않았다. 프롬프트가 갈라지면 여기서 나오는
 * 답이 `bench:assist`로 잰 것과 달라지고, 그러면 측정이 무의미해진다.
 *
 * <p>이 계약은 `services/` 안에만 있다. `packages/*`에 모델 이름도 URL도 키도 들어가지
 * 않는다 (불변 규칙 9).
 */
export interface LlmClient {
  /**
   * 어느 모델이 답했는가. 화면의 출처 배지(AI-8)에 그대로 실린다.
   *
   * <p>사용자에게 "AI가 도왔다"까지만 말하고 <b>어느 AI인지</b> 숨기면, 답이 이상할 때
   * 무엇을 의심해야 하는지 알 수 없다. 모델 이름은 비밀이 아니다 — 키가 비밀이다.
   */
  readonly name: string;

  /**
   * JSON 응답을 요구하는 한 번의 생성.
   *
   * @param schema 응답 형태. 지원하는 공급자는 이것으로 강제하고, 아닌 곳은
   *   프롬프트에 붙여 부탁한다. 어느 쪽이든 <b>돌려받은 것을 믿지 않는 것</b>은
   *   호출부의 몫이다 (`validateProposal`).
   */
  json(system: string, user: string, schema: unknown): Promise<unknown>;
}

/**
 * 앞의 것이 안 되면 다음 것으로 (AI-1).
 *
 * <p>**모두 실패하면 `null`이다.** 예외를 던지지 않는 것이 요점이다 — 호출부는 이미
 * `null`을 다룰 줄 안다(도우미가 모르면 되묻기로 내려간다). 새 실패 모양을 만들면
 * 그것을 다루는 코드를 모든 호출부에 새로 넣어야 하고, 넣다 빠뜨린 한 곳에서
 * 시연 중에 화면이 멈춘다.
 *
 * <p><b>순서가 곧 정책이다.</b> 먼저 둔 것이 품질이 낫다고 판단한 쪽이고, 뒤엣것은
 * 그것이 막혔을 때의 예비다. 어느 쪽이 나은지는 `bench:assist`를 공급자별로 돌려
 * 정한다 (AI-10) — 순서를 감으로 정하지 않는다.
 */
export class FallbackLlm implements LlmClient {
  readonly #clients: readonly LlmClient[];
  readonly #note: (message: string) => void;

  /** 마지막으로 <b>실제로 답한</b> 공급자. 출처 배지가 이 값을 쓴다. */
  #answered: string | null = null;

  constructor(clients: readonly LlmClient[], onNote?: (message: string) => void) {
    if (clients.length === 0) throw new Error("공급자가 하나도 없습니다.");
    this.#clients = clients;
    this.#note = onNote ?? (() => {});
  }

  get name(): string {
    return this.#answered ?? this.#clients[0]!.name;
  }

  /** 어느 것이 답했는지. 아직 아무도 안 불렀으면 `null`. */
  get answeredBy(): string | null {
    return this.#answered;
  }

  async json(system: string, user: string, schema: unknown): Promise<unknown> {
    for (const client of this.#clients) {
      try {
        const value = await client.json(system, user, schema);
        /*
         * `null`은 실패가 아니라 **답이다.** 모델이 "맞는 것 없음"을 낸 경우가 여기로
         * 오는데, 그것을 실패로 보고 다음 공급자에게 다시 물으면 <b>거절이 뒤집힌다.</b>
         * 답 없는 질의 100건 중 97건을 옳게 거절하는 성질이 그렇게 무너진다.
         */
        this.#answered = client.name;
        return value;
      } catch (error) {
        // 왜 넘어갔는지는 서버 로그에만 남긴다. 본문에는 키가 섞여 있을 수 있다.
        this.#note(
          `${client.name} 실패 — 다음 공급자로: ${
            error instanceof Error ? error.message.slice(0, 120) : "알 수 없음"
          }`,
        );
      }
    }

    this.#answered = null;
    return null;
  }
}

/**
 * 스키마를 프롬프트에 붙인다. **스키마를 강제하지 못하는 공급자를 위한 것이다.**
 *
 * <p>Gemini는 `responseSchema`로 모양을 강제하지만 OpenAI 호환 엔드포인트의 JSON 모드는
 * "JSON이기만 하면 된다"까지만 보장한다. 그 차이를 프롬프트로 메운다 — 완벽하지 않지만,
 * <b>어차피 돌려받은 것은 검증을 지난다.</b> 여기서 완벽을 노릴 이유가 없다.
 */
export function describeSchema(schema: unknown): string {
  return `\n\n반드시 이 JSON 스키마에 맞는 JSON 하나만 답하세요. 설명을 덧붙이지 마세요.\n${JSON.stringify(schema)}`;
}
