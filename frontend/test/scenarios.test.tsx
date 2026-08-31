import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, describe, expect, it } from "vitest";
import { MockSttProvider } from "@minui/voice";
import { App, type Mode } from "../src/App.js";
import { MockBankApi } from "../src/api/mockApi.js";
import {
  TaskRecorderProvider,
  useTaskRecorder,
  type TaskRun,
} from "../src/instrumentation/TaskRecorder.js";

/**
 * 과제 수행 비교 측정 (기획안 §12.2-A).
 *
 * <p><b>이것은 사용자 테스트가 아니다.</b> 스크립트는 망설이지 않고, 헤매지 않고, 글자를
 * 읽는 데 시간을 쓰지 않는다. 그래서 여기서 나오는 것은 §12.1의 네 지표 중 **탭 횟수**
 * 하나뿐이며, 그마저도 "이 UI에서 이 과제를 끝내는 데 최소 몇 번 눌러야 하는가"라는
 * 구조적 하한이다.
 *
 * <p>그래도 잴 값어치가 있는 이유는 탭 횟수가 UI 구조의 성질이기 때문이다. 사람마다
 * 달라지지 않으므로, 이 수치는 사용자 테스트 없이도 지금 확정할 수 있는 유일한 지표다.
 * 완료 시간·완료율·오탐색률은 사람이 있어야 나온다 — 그 자리는 비워 둔다.
 */

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../tools/out/task-metrics.json",
);

const collected: TaskRun[] = [];

/** 계측기를 테스트에서 조작하기 위한 손잡이. */
let handle: ReturnType<typeof useTaskRecorder> | null = null;

function Harness({ mode, stt }: { mode: Mode; stt?: MockSttProvider }) {
  handle = useTaskRecorder();
  return (
    <App
      api={new MockBankApi()}
      initialMode={mode}
      storageKey={`m5-${mode}-${Math.random()}`}
      {...(stt ? { stt } : {})}
    />
  );
}

async function boot(mode: Mode, stt?: MockSttProvider) {
  const view = render(
    <TaskRecorderProvider>
      <Harness mode={mode} {...(stt ? { stt } : {})} />
    </TaskRecorderProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("group", { name: "화면 방식" })).toBeInTheDocument(),
  );
  /*
   * **카드가 생긴 것이 아니라 잔액이 채워진 것을 기다린다.**
   *
   * <p>전에는 버튼이 DOM에 있으면 준비된 것으로 봤다. 그런데 카드의 금액은 원장을
   * 불러온 <b>뒤에</b> 들어차므로, 그 사이에 단언이 실행되면 빈 카드를 읽는다.
   * S2는 "탭 0회로 잔액이 읽힌다"를 재는 과제라 바로 그 값을 보는데, 병렬 부하가
   * 걸린 날에만 간헐로 깨졌다 — 시간이 아니라 <b>기다리는 대상</b>이 틀렸던 것이다.
   */
  if (mode === "minui") {
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /잔액 보기/ })).toHaveTextContent(/\d,\d{3}원/),
    );
  } else {
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "주거래 통장" })).toHaveTextContent(/\d,\d{3}원/),
    );
  }
  return view;
}

/**
 * 한 과제를 한 모드에서 수행하고 기록을 남긴다.
 *
 * 모드마다 앱을 새로 띄우고 끝나면 반드시 내린다. 두 모드가 DOM에 함께 남아 있으면
 * 질의가 양쪽을 다 집어 측정이 무의미해진다.
 */
async function measure(
  taskId: string,
  targetMenuId: string,
  mode: Mode,
  perform: () => Promise<void>,
  options: { stt?: MockSttProvider; label?: string } = {},
): Promise<TaskRun> {
  const view = await boot(mode, options.stt);
  try {
    handle!.begin(taskId, targetMenuId, mode);
    await perform();

    // 화면에 이미 답이 있어 아무것도 누를 필요가 없는 과제(S2)는 여기서 끝난다.
    const finished = handle!.finish(targetMenuId) ?? handle!.getRuns().at(-1)!;
    const labelled = options.label ? { ...finished, taskId: options.label } : finished;
    collected.push(labelled);
    return labelled;
  } finally {
    view.unmount();
  }
}

afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(collected, null, 2), "utf8");
});

// ── 과제 정의 ────────────────────────────────────────────────────────────

/** S1 — 매달 하는 관리비 이체. 기획안 §5.2의 대표 시나리오. */
async function s1(mode: Mode) {
  if (mode === "minui") {
    await userEvent.click(screen.getByRole("button", { name: /계좌 이체/ }));
  } else {
    const card = screen.getByRole("region", { name: "주거래 통장" });
    await userEvent.click(within(card).getByRole("button", { name: "이체" }));
  }
  /*
   * 받는 분을 고르는 단계. **두 모드가 같은 이체 화면에 도착하므로 이 한 단계는
   * 양쪽에 똑같이 붙는다** — §12.2의 탭 수 비교는 그대로 유효하다. 절댓값만 하나씩 는다.
   *
   * 전에는 맨 앞 수취인이 미리 골라져 있어 이 줄이 없었는데, 그것은 엔진이 아무도
   * 고르지 않은 자리를 화면이 덮은 것이었다 (`payeeRefusal.test.tsx`).
   */
  await userEvent.selectOptions(
    screen.getByLabelText("받는 분"),
    screen.getByRole("option", { name: /행복아파트 관리사무소/ }),
  );
  await userEvent.type(screen.getByLabelText("보낼 금액"), "187000");
  /*
   * 확인 화면도 두 모드가 같은 컴포넌트를 쓰므로 세 걸음이 양쪽에 똑같이 붙는다.
   * §12.2의 탭 수 비교는 그대로 유효하고 절댓값만 함께 는다.
   */
  await userEvent.click(screen.getByRole("button", { name: "내용 확인하기" }));
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "네, 확인하고 보내기" }));
  await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
}

/** S3의 마지막 동작 — 자동이체 하나를 멈춘다. */
async function stopAutoTransfer() {
  const dialog = await screen.findByRole("dialog", { name: "자동이체 관리" });
  const row = within(dialog).getByText("한국전력공사").closest("li")!;
  await userEvent.click(within(row).getByRole("button", { name: "그만 내기" }));
}

/** S3-음성 — 기획안 S3이 그린 경로. "자동이체 안 나가게 해야 하는데"라고 말한다. */
async function s3Voice() {
  await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
  await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));
  const found = await screen.findByRole("region", { name: "찾은 메뉴" });
  await userEvent.click(within(found).getByRole("button", { name: /자동이체 관리/ }));
  await stopAutoTransfer();
}

/** S3-전체메뉴 — 음성을 쓰지 않고 쉬운 모드의 평평한 목록에서 찾는다. */
async function s3Menu() {
  await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));
  const sheet = screen.getByRole("dialog", { name: "전체 메뉴" });
  await userEvent.click(within(sheet).getByRole("button", { name: "자동이체 관리" }));
  await stopAutoTransfer();
}

/** S3-기본UI — 전체 탭 → 카테고리 펼치기 → 메뉴. */
async function s3Classic() {
  await userEvent.click(screen.getByRole("button", { name: "전체" }));
  const all = screen.getByRole("region", { name: "전체 메뉴" });
  await userEvent.click(within(all).getByRole("button", { name: /이체/ }));
  await userEvent.click(within(all).getByRole("button", { name: "자동이체 관리" }));
  await stopAutoTransfer();
}

/** 꼬리 과제 — 카드에도 없고 기본 UI 홈 바로가기에도 없는 메뉴. */
async function tail(mode: Mode, label: string, category: string) {
  if (mode === "minui") {
    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));
    const sheet = screen.getByRole("dialog", { name: "전체 메뉴" });
    await userEvent.click(within(sheet).getByRole("button", { name: label }));
  } else {
    await userEvent.click(screen.getByRole("button", { name: "전체" }));
    const all = screen.getByRole("region", { name: "전체 메뉴" });
    await userEvent.click(within(all).getByRole("button", { name: new RegExp(category) }));
    await userEvent.click(within(all).getByRole("button", { name: label }));
  }
  await screen.findByRole("dialog", { name: label });
}

// ── 측정 ────────────────────────────────────────────────────────────────

describe("S1 반복 이체", () => {
  it("두 모드에서 수행하고 탭 수를 비교한다", async () => {
    const minui = await measure("S1", "transfer.account", "minui", () => s1("minui"));
    const classic = await measure("S1", "transfer.account", "classic", () => s1("classic"));

    expect(minui.completed).toBe(true);
    expect(classic.completed).toBe(true);
    // 기본 UI도 홈에 이체 바로가기를 두므로 큰 차이가 나지 않는 것이 정상이다.
    expect(minui.taps).toBeLessThanOrEqual(classic.taps);
  });
});

describe("S2 잔액 확인", () => {
  it("두 모드 모두 홈에서 잔액이 읽힌다 — 탭 0회", async () => {
    const minui = await measure("S2", "inquiry.balance", "minui", async () => {
      expect(screen.getByRole("button", { name: /잔액 보기/ })).toHaveTextContent(
        "1,243,500원",
      );
    });
    const classic = await measure("S2", "inquiry.balance", "classic", async () => {
      const card = screen.getByRole("region", { name: "주거래 통장" });
      expect(within(card).getByText("1,243,500원")).toBeInTheDocument();
    });

    expect(minui.taps).toBe(0);
    expect(classic.taps).toBe(0);
  });
});

describe("S3 자동이체 관리", () => {
  it("세 경로를 모두 잰다 — 음성, 쉬운 모드 전체 메뉴, 기본 UI 메뉴 트리", async () => {
    const voice = await measure(
      "S3",
      "transfer.auto",
      "minui",
      s3Voice,
      {
        // 기획안 S3의 발화를 그대로 넣는다.
        stt: new MockSttProvider([{ text: "자동이체 안 나가게 해야 하는데" }]),
        label: "S3 (음성)",
      },
    );
    const menu = await measure("S3", "transfer.auto", "minui", s3Menu, {
      label: "S3 (전체 메뉴)",
    });
    const classic = await measure("S3", "transfer.auto", "classic", s3Classic, {
      label: "S3 (기본 UI)",
    });

    for (const run of [voice, menu, classic]) {
      expect(run.completed, run.taskId).toBe(true);
      expect(run.offTarget, run.taskId).toBe(0);
    }

    // 쉬운 모드의 전체 메뉴는 한 단계 평평하므로 기본 UI보다 적게 눌린다.
    expect(menu.taps).toBeLessThan(classic.taps);
  });
});

describe("꼬리 과제 — 카드에도 홈 바로가기에도 없는 메뉴", () => {
  const cases = [
    ["한도 변경", "이체 한도 변경", "설정"],
    ["인증서 관리", "인증서 관리", "인증"],
    ["해외 송금", "해외 송금", "이체"],
  ] as const;

  it.each(cases)("%s", async (taskId, label, category) => {
    const targetId = { "이체 한도 변경": "settings.limit", "인증서 관리": "auth.certificate", "해외 송금": "transfer.overseas" }[label]!;

    await measure(taskId, targetId, "minui", () => tail("minui", label, category));
    await measure(taskId, targetId, "classic", () => tail("classic", label, category));

    const runs = collected.filter((r) => r.taskId === taskId);
    expect(runs).toHaveLength(2);
  });
});
