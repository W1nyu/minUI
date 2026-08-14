# @minui/core

프레임워크 무관 개인화 랭킹 엔진. **의존성 0.** React·DOM·Node API를 참조하지 않는다.

호스트 앱이 제공할 것은 두 개뿐이다.

```ts
import { MinUIEngine } from "@minui/core";

const engine = await MinUIEngine.create({
  // ① 메뉴 카탈로그
  catalog: [
    {
      id: "transfer.account",
      label: "계좌 이체",
      synonyms: ["돈 보내기", "송금", "부치기"],
      category: "이체",
      icon: "transfer",
      route: "/transfer/account",
      riskLevel: "high", // high면 음성으로 자동 실행되지 않는다
    },
    // ...
  ],

  // ② 메뉴 ID를 받아 화면을 여는 함수 — 호스트 라우터를 부르기만 하면 된다
  onAction: (menuId) => router.push(catalogById[menuId].route),
});

engine.getCards(); // 홈에 그릴 큰 카드 4~6개
engine.open("transfer.account"); // 사용 기록 + onAction 호출
engine.complete("transfer.account"); // 작업이 끝났음을 알림
```

인증·세션·API 호출은 전부 호스트 책임으로 남아 있다.
엔진은 **무엇을 보여줄지만 정하고, 어떻게 실행할지는 모른다.**

## 선택 옵션

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `storage` | 세션 메모리 | `load()`/`save()` 두 메서드짜리 어댑터. 웹용 IndexedDB 구현은 `@minui/react`에 있다 |
| `config` | `DEFAULT_CONFIG` | 가중치·마진·임계치. 전부 JSON 직렬화 가능한 값 |
| `now` | `Date.now` | 시각 주입. 엔진 내부는 시각을 직접 읽지 않는다 |
| `coldStartPresets` | 카탈로그 순서 | 온보딩 의도별 초기 카드 세트 |

## 이 패키지가 지키는 것

- **화면은 세션 도중 절대 바뀌지 않는다.** 재배치는 다음 세션에 반영된다.
- **하루에 한 장만 바뀐다.** 20% 점수 마진과 24시간 쿨다운을 모두 통과해야 한다.
- **자리를 지킨다.** 랭킹 순서가 바뀌어도 남은 카드는 움직이지 않고, 새 카드는 나간 카드의 자리에 들어간다.
- **수집하는 것은 `{메뉴ID, 시각, 완료여부}`와 사용자가 직접 친 짧은 검색어뿐이다.**
  금액·계좌번호·수취인이 들어올 자리가 없다 — 숫자가 든 검색어는 저장되지 않는다.

근거는 `docs/기획안.md` §8.2와 §11.1에 있고, 규칙은 `test/`와 `fixtures/`가 강제한다.

## 메뉴가 사용자의 말을 배운다

검색이 못 알아들은 말로 사용자가 끝내 그 메뉴에 도달하면, 그 말이 **이 기기에서** 그
메뉴의 이름이 된다. `@minui/react`의 말로 찾기 화면이 이미 배선돼 있어 **호스트가 할 일은
없다.** 직접 얹는다면 검색 결과에서 고른 순간을 알려 주면 된다.

```ts
engine.noteSearchChoice("관리비", "transfer.auto"); // 화면은 열지 않는다
engine.getLearnedTerms();                           // 무엇을 배웠는지
engine.forgetTerm("관리비", "transfer.auto");        // 하나 지우기
engine.forgetAllTerms();                            // 전부 지우기
```

정확히 같은 말일 때만 걸리고, 반복될수록 점수가 오르되 **라벨 정확 매칭을 이기지 못한다.**
`config.learning.enabled: false`로 끌 수 있다. 근거와 측정은 `docs/기획안.md` §8.4·§12.8.

## 왜 이 카드가 여기 있는가

개인화가 조용한 것은 원칙이지만, 물어봤을 때 답하지 못하면 깜깜한 것이다.

```ts
engine.explainCards();
// [{ menuId: "transfer.account", reason: { kind: "used", views: 6, … }, isNew: false }, …]
```

`getCards()`와 같은 순서로, 카드마다 이유 하나를 준다 — `pinned` / `used` / `preset`.
**문구는 담지 않는다.** 판단은 엔진이 하고 말은 호스트가 고른다. `@minui/react`의
`<AdaptationSheet>`가 기본 문구를 갖고 있다.

## 다른 언어로 포팅할 때

`fixtures/*.json`이 언어 중립 동작 명세다. 설정과 시나리오가 모두 JSON이므로,
포팅한 구현이 같은 픽스처로 같은 결과를 내는지 확인하면 된다. 자세한 내용은
`fixtures/README.md` 참고.
