# 시나리오 픽스처

여기 있는 JSON은 **엔진 동작의 언어 중립 명세**다. `@minui/core`의 테스트가 이 파일들을
읽어 검증하지만, 파일 자체에는 TypeScript가 한 줄도 없다. 나중에 Dart·Kotlin·Swift로
엔진을 포팅하면 같은 파일을 읽어 같은 결과가 나오는지 확인하면 된다.

## 형식

```jsonc
{
  "name": "시나리오 이름",
  "config": { /* MinUIConfig 부분 덮어쓰기 (선택) */ },
  "profile": { "intent": "inquiry", "textScale": "normal" },
  "presets": { "inquiry": ["..."], "transfer": ["..."], "invest": ["..."] },
  "menus": [ /* MenuItem[] */ ],
  "sessions": [
    {
      "at": "2026-01-01T09:00:00Z",       // 세션 시작 시각 (UTC)
      "expectCards": ["a", "b"],          // 세션 시작 직후 카드 (순서 포함)
      "expectNewBadges": ["b"],           // '새로 추가됨' 배지가 붙은 카드
      "maxChangesFromPrevious": 1,        // 직전 세션 대비 바뀐 카드 수 상한
      "use": [
        { "menuId": "a", "times": 3, "completed": true, "everyHours": 1 }
      ]
    }
  ]
}
```

- 세션은 순서대로 실행된다. 각 세션은 엔진을 새로 열고(`create`) 사용을 기록한 뒤 닫는다.
- `use[].everyHours`를 주면 반복 사용이 그 간격으로 흩어진다. 생략하면 1시간 간격.
- 저장소는 세션 사이에 유지된다 — 상태 이월이 검증 대상이기 때문이다.

## 검증 대상 규칙

`docs/기획안.md` §8.2와 `AGENTS.md` 불변 규칙 5에 대응한다.

1. 콜드 스타트에서는 온보딩 프리셋이 화면이 된다
2. 사용이 쌓이기 전에는 재배치가 일어나지 않는다
3. 재배치가 확정돼도 그 세션에는 보이지 않는다
4. 한 세션에 카드는 최대 한 장 바뀐다
5. 새로 들어온 카드에만 배지가 붙고, 기간이 지나면 사라진다
