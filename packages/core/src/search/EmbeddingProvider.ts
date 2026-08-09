import type { MenuId } from "../types.js";

/**
 * 의미 매칭 ③ (기획안 §8.3).
 *
 * 인터페이스로 격리한 이유는 STT를 Provider로 뺀 것과 같다(§9.1) — 지금은 의존성 0인
 * n-gram TF-IDF로 쓰고, 나중에 문장 임베딩 모델 구현체로 갈아끼울 수 있어야 한다.
 * 기획안 §14가 "경량 모델 선정과 실측"을 M4의 확인 항목으로 남겨 둔 지점이며,
 * 두 방식의 비교는 tools의 벤치마크가 수치로 답한다.
 *
 * 색인은 빌드 타임 산출물이어야 한다. 그래서 JSON으로 직렬화 가능해야 하고,
 * 런타임에는 질의 하나만 인코딩한다. 네트워크 호출은 어느 구현에서도 없다.
 */
export interface EmbeddingProvider {
  /** 질의와 각 메뉴의 유사도. 0..1. 색인에 없는 메뉴는 빠질 수 있다. */
  similarity(query: string): Map<MenuId, number>;
}

/** 색인된 문서 하나. terms는 이미 정규화되어 있다. */
export interface IndexDocument {
  menuId: MenuId;
  terms: string[];
}
