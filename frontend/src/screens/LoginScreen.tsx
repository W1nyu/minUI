import { useCallback, useState } from "react";
import { accountsOf, usersByGroup, type DemoUser } from "../session/personas.js";

/**
 * 시연용 로그인 — 사람을 고르고 여섯 자리를 넣는다.
 *
 * <p>실제 은행 앱의 간편 로그인 자리를 본떴지만 <b>인증이 아니고 비밀번호도 없다.</b>
 * 키패드는 은행 앱의 모양을 보여 주려고 둔 시늉이라 <b>무엇을 누르든 들어간다.</b>
 * 그 사실을 화면 아래에 상시로 적어 둔다 — 없는 보장을 화면이 대신 주장하게 두지 않는
 * 것이 이 저장소가 가상 원장 고지 띠와 연습 모드 배지에서 지켜 온 방식이다.
 *
 * <p>두 걸음으로 나눈다 — 사람 고르기와 번호 넣기. 한 화면에 둘 다 두면 카드 열두 장
 * 아래에 키패드가 붙어 화면이 길어지고, 번호를 넣는 동안 누구를 골랐는지가 화면 밖으로
 * 밀려난다. 고른 사람은 두 번째 걸음의 맨 위에 계속 떠 있다.
 */
export function LoginScreen({
  onSignIn,
}: {
  /** 그 사람으로 들어간다. 누른 숫자는 넘기지 않는다 — 받는 쪽이 쓸 일이 없다. */
  onSignIn: (userId: string) => boolean;
}) {
  const [picked, setPicked] = useState<DemoUser | null>(null);

  if (picked === null) {
    return <UserPicker onPick={setPicked} />;
  }

  return (
    <PinPad user={picked} onBack={() => setPicked(null)} onDone={() => onSignIn(picked.id)} />
  );
}

function UserPicker({ onPick }: { onPick: (user: DemoUser) => void }) {
  return (
    <div className="login">
      <header className="login-head">
        <h1 className="login-title">누구로 볼까요?</h1>
        <p className="login-lead">시연용 계정입니다. 골라서 들어가 보세요.</p>
      </header>

      {usersByGroup().map(({ group, users }) => (
        <section className="login-group" key={group}>
          <h2 className="login-group-title">{group}</h2>
          <ul className="login-user-grid">
            {users.map((user) => {
              const accounts = accountsOf(user.id);
              return (
                <li key={user.id}>
                  <button type="button" className="login-user" onClick={() => onPick(user)}>
                    <span className="login-user-name">{user.name}</span>
                    <span className="login-user-meta">
                      {user.ageBand} · 통장 {accounts.length}개
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <DemoDisclaimer />
    </div>
  );
}

const PIN_LENGTH = 6;

function PinPad({
  user,
  onBack,
  onDone,
}: {
  user: DemoUser;
  onBack: () => void;
  onDone: () => void;
}) {
  const [pin, setPin] = useState("");

  const press = useCallback(
    (digit: string) => {
      const next = `${pin}${digit}`.slice(0, PIN_LENGTH);
      setPin(next);
      /*
       * 여섯 자리가 차면 들어간다. **무엇을 눌렀는지는 보지 않는다.**
       *
       * 비교할 값을 어딘가에 두면 그것만으로 이 화면이 지키는 것이 있는 척하게 된다.
       * 여기서 여섯 자리를 세는 이유는 오직 하나 — 실제 은행 앱의 간편 로그인이
       * 그렇게 생겼기 때문이다. 지연이나 실패를 흉내 내지도 않는다.
       */
      if (next.length === PIN_LENGTH) onDone();
    },
    [pin, onDone],
  );

  const erase = useCallback(() => setPin((current) => current.slice(0, -1)), []);

  return (
    <div className="login">
      <header className="login-head">
        <button type="button" className="login-back" onClick={onBack}>
          ← 다른 사람
        </button>
        <h1 className="login-title">{user.name}님</h1>
        <p className="login-lead">간편 비밀번호 여섯 자리를 눌러 주세요.</p>
      </header>

      {/*
        입력한 자릿수만 점으로 보여 준다. 숫자를 그대로 띄우지 않는 것은 은행 앱의
        습관을 따르는 것이지 이 데모가 무엇을 지켜서가 아니다.
      */}
      <p className="login-dots" aria-label={`${pin.length}자리 입력함`}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span key={index} data-filled={index < pin.length} aria-hidden="true" />
        ))}
      </p>

      <div className="login-keypad" role="group" aria-label="간편 비밀번호 키패드">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            type="button"
            className="login-key"
            aria-label={`숫자 ${digit}`}
            onClick={() => press(digit)}
          >
            {digit}
          </button>
        ))}
        <span className="login-key login-key-blank" aria-hidden="true" />
        <button
          type="button"
          className="login-key"
          aria-label="숫자 0"
          onClick={() => press("0")}
        >
          0
        </button>
        <button type="button" className="login-key login-key-quiet" onClick={erase}>
          지우기
        </button>
      </div>

      <DemoDisclaimer />
    </div>
  );
}

/**
 * 화면에서 사라지지 않는 고지.
 *
 * <p>연습 모드 배지·가상 원장 띠와 같은 규칙이다 — 무엇을 보고 있는지 모르는 데모가
 * 제일 나쁘다.
 */
function DemoDisclaimer() {
  return (
    <p className="login-disclaimer">
      시연용 계정입니다. <strong>비밀번호를 확인하지 않으며</strong> 어떤 실계좌와도
      연결되지 않습니다.
    </p>
  );
}
