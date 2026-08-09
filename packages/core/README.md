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
- **수집하는 것은 `{메뉴ID, 시각, 완료여부}`뿐이다.** 금액·계좌번호·수취인이 들어올 자리가 없다.

근거는 `docs/기획안.md` §8.2와 §11.1에 있고, 규칙은 `test/`와 `fixtures/`가 강제한다.

## 다른 언어로 포팅할 때

`fixtures/*.json`이 언어 중립 동작 명세다. 설정과 시나리오가 모두 JSON이므로,
포팅한 구현이 같은 픽스처로 같은 결과를 내는지 확인하면 된다. 자세한 내용은
`fixtures/README.md` 참고.
