"""가짜 백본 트래픽 데이터 만들기 (전부 가상 데이터).

만드는 파일 (data/ 폴더):
  links.csv    - 링크 8개와 회선 용량(Gbps)
  events.csv   - 가상 월드컵 경기 7개와 "예상 배율", 경기 중 표시 구간(marks)
  temps.csv    - 서버실 랙 6개의 입구 온도(5분 간격), 냉각 이상 사례 1건
  servers.csv  - 서버 24대 (역할, 디스크 경고, 꺼짐 시간)
  traffic.csv  - 5분 간격 in/out (Gbps), 14일치

실제 회사·센터·회선 수치와 실제 월드컵 일정·팀은 쓰지 않았다. 일정과 숫자는 모두 지어낸 것이다.
같은 seed면 항상 같은 데이터가 나온다.
"""
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
OUT = Path(__file__).parent / "data"
START = "2026-10-19 00:00"   # 월요일
DAYS = 14
STEP = "5min"

# 링크: 이름, 설명, 용량(Gbps), 평소 저녁 피크 사용률(out 기준)
LINKS = [
    ("OUR-A", "분당 센터 백본 A", 100, 0.45),
    ("OUR-B", "분당 센터 백본 B", 100, 0.30),
    ("CTR-B1", "안산 센터 백본 1", 100, 0.40),
    ("CTR-B2", "안산 센터 백본 2", 100, 0.25),
    ("CTR-C1", "구로 센터 백본", 200, 0.35),
    ("CTR-D1", "서초 센터 백본", 400, 0.40),
    ("IX-1", "국내 연동(IX)", 100, 0.38),
    ("INTL-1", "해외 연동", 100, 0.28),
]

# 경기 한 번의 길이: 킥오프~종료 115분 (전반 47 + 하프타임 15 + 후반 약 53). 2시간을 넘지 않는다.
LEN_MIN = 115
# 경기 중 표시 구간: (종류, 킥오프 후 시작분, 끝분). 하이드레이션 타임은 전·후반 중간쯤 약 3분(가상).
MARKS = [("hydration", 25, 28), ("halftime", 47, 62), ("hydration", 87, 90)]

A3 = ["OUR-A", "CTR-B1", "IX-1"]
# id, 이름, 킥오프, 영향 링크, 예상 배율(고객사에 알린 값), 실제 배율(숨김값)
MATCHES = [
    ("EV1", "월드컵 조별 1경기", "2026-10-24 22:00", A3, 1.5, 1.6),
    ("EV2", "월드컵 조별 2경기", "2026-10-25 02:00", A3, 1.5, 1.6),     # 새벽 경기
    ("EV3", "월드컵 조별 3경기", "2026-10-26 20:00", A3, 1.5, 1.75),
    ("EV4", "월드컵 16강", "2026-10-28 22:00", A3, 1.6, 1.7),
    ("EV5", "월드컵 8강", "2026-10-30 20:00", A3 + ["OUR-B"], 1.7, 2.0),
    ("EV6", "월드컵 4강", "2026-10-31 02:00", A3 + ["OUR-B"], 1.7, 1.9),  # 새벽 경기
    ("EV7", "월드컵 결승", "2026-11-01 20:00", A3 + ["OUR-B", "CTR-C1"], 1.8, 1.95),
]

# 예고 없던 일: 새벽 in 트래픽 급증(DDoS 의심). 경기 없는 날 새벽.
UNPLANNED = ("2026-10-29 03:10", "2026-10-29 03:35", "OUR-B", 6.0)

# 갑자기 빠지는 일(급감): 정상 운영 중 트래픽이 평소보다 크게 줄어든다.
# 시작, 끝, 링크, 남는 비율(out), 남는 비율(in), 설명
DROPS = [
    ("2026-10-23 20:10", "2026-10-23 20:55", "IX-1", 0.15, 0.15, "연동 회선 장애로 우회 (저녁 피크 중)"),
    ("2026-10-21 14:20", "2026-10-21 14:45", "CTR-B1", 0.02, 0.02, "회선 다운 (in·out 모두 거의 0)"),
]
# IX-1에서 빠진 트래픽의 60%가 INTL-1로 돌아간다 (한쪽이 빠지면 다른 쪽이 튄다)
SHIFT = ("IX-1", "INTL-1", 0.6)

# 서버실: 랙 6개 x 서버 4대. 랙 입구 온도(inlet)를 5분 간격으로 만든다. 전부 가상.
RACKS = ["A-01", "A-02", "A-03", "B-01", "B-02", "B-03"]
ROLES = ["웹", "DB", "캐시", "스토리지"]
# 냉각 이상: A-03 랙, 14:30에 오르기 시작 -> 15:30 최고 -> 16:30까지 유지 -> 17:15에 복구
COOLING = ("A-03", "2026-10-26 14:30", "2026-10-26 15:30", "2026-10-26 16:30", "2026-10-26 17:15", 11.5)
# 과열로 서버 한 대가 꺼짐: A-03의 2번 서버, 16:05~16:25
SERVER_DOWN = ("A-03", 2, "2026-10-26 16:05", "2026-10-26 16:25")
# 디스크 경고가 계속 켜져 있는 서버(교체 대기): A-02의 3번 서버
HDD_WARN = ("A-02", 3)


def daily_shape(hours: np.ndarray, weekend: bool) -> np.ndarray:
    """평소 하루 모양: 새벽 낮음, 저녁 피크. 0~1 사이 값."""
    base = 0.25 + 0.15 * np.sin((hours - 9) / 24 * 2 * np.pi)
    evening = 0.65 * np.exp(-((hours - 21) ** 2) / (2 * 2.2**2))
    shape = base + evening
    if weekend:  # 주말은 낮이 더 높고 피크가 약간 넓다
        shape = shape + 0.10 * np.exp(-((hours - 14) ** 2) / (2 * 3.0**2))
    return shape / shape.max()


def match_profile(k: int):
    """경기 하나의 시청 곡선(0~1). 1분 단위. m = 킥오프 기준 분."""
    rng = np.random.default_rng(SEED + k)
    m = np.arange(-60, LEN_MIN + 31)
    p = np.zeros(len(m))
    for i, x in enumerate(m):
        if x < -30:
            v = 0.0
        elif x < 0:
            v = 0.85 * (x + 30) / 30                    # 킥오프 30분 전부터 상승
        elif x < 47:
            v = 0.92 + 0.08 * max(0, 5 - x) / 5         # 전반: 초반이 가장 높음
        elif x < 62:
            v = 0.55                                    # 하프타임: 트래픽이 빠진다
        elif x <= LEN_MIN:
            v = 0.95 + 0.05 * (x - 62) / (LEN_MIN - 62)  # 후반: 종료 쪽으로 갈수록 높음
        else:
            v = 0.30 * np.exp(-(x - LEN_MIN) / 6)       # 종료 직후 급락, 짧은 꼬리
        p[i] = v
    for kind, a, b in MARKS:
        if kind == "hydration":
            p[(m >= a) & (m < b)] *= 0.65               # 쭉 빠졌다가 다시 들어온다
    goal_pool = np.r_[np.arange(5, 22), np.arange(30, 45), np.arange(66, 84), np.arange(92, 108)]
    for g in rng.choice(goal_pool, 2, replace=False):   # 골 장면: 잠깐 3분 +10%
        p[(m >= g) & (m < g + 3)] *= 1.10
    return m, p


def write_server_room(times: pd.DatetimeIndex, hours: np.ndarray) -> None:
    """랙 입구 온도(temps.csv)와 서버 목록(servers.csv)을 만든다."""
    rng = np.random.default_rng(SEED + 100)   # 트래픽 난수와 분리 (트래픽 데이터는 그대로)
    shape = daily_shape(hours, False)
    tm = np.asarray((times - times[0]) / pd.Timedelta(minutes=1))
    mins = lambda ts: (pd.Timestamp(ts) - times[0]) / pd.Timedelta(minutes=1)
    rows = []
    for i, rack in enumerate(RACKS):
        temp = 21.5 + 0.3 * i + 1.5 * shape + rng.normal(0, 0.12, len(times))
        if rack == COOLING[0]:
            _r, a, pk, hold, end, add = COOLING
            a, pk, hold, end = mins(a), mins(pk), mins(hold), mins(end)
            d = np.zeros(len(times))
            up = (tm >= a) & (tm < pk)
            d[up] = add * (tm[up] - a) / (pk - a)
            d[(tm >= pk) & (tm < hold)] = add
            dn = (tm >= hold) & (tm < end)
            d[dn] = add * (1 - (tm[dn] - hold) / (end - hold))
            temp = temp + d
        rows.append(pd.DataFrame({"time": times, "rack": rack, "inlet_c": temp.round(1)}))
    pd.concat(rows).to_csv(OUT / "temps.csv", index=False)

    srv = []
    for rack in RACKS:
        for slot in range(1, 5):
            down = SERVER_DOWN if (rack, slot) == SERVER_DOWN[:2] else None
            srv.append((rack, slot, f"{rack}-S{slot}", ROLES[slot - 1],
                        int((rack, slot) == HDD_WARN),
                        down[2] if down else "", down[3] if down else ""))
    pd.DataFrame(srv, columns=["rack", "slot", "name", "role", "hdd_warn", "down_start", "down_end"]
                 ).to_csv(OUT / "servers.csv", index=False)


def main() -> None:
    rng = np.random.default_rng(SEED)
    OUT.mkdir(exist_ok=True)
    times = pd.date_range(START, periods=DAYS * 288, freq=STEP)
    hours = (times.hour + times.minute / 60).to_numpy()
    weekend = np.asarray(times.dayofweek) >= 5
    t0 = pd.Timestamp(START)

    # 경기별 5분 단위 시청 곡선 (1분 단위로 만든 뒤 5분 평균)
    prof5 = {}
    for k, (eid, _n, kick, _l, _e, _a) in enumerate(MATCHES):
        m, p = match_profile(k)
        minute = np.zeros(DAYS * 1440)
        kick_min = int((pd.Timestamp(kick) - t0).total_seconds() / 60)
        idx = kick_min + m
        ok = (idx >= 0) & (idx < len(minute))
        minute[idx[ok]] = p[ok]
        prof5[eid] = minute.reshape(-1, 5).mean(axis=1)

    lost = np.zeros(len(times))   # IX-1에서 빠진 양 (INTL-1이 이어서 받는다)
    rows = []
    for name, _desc, cap, peak in LINKS:
        shape = np.where(weekend, daily_shape(hours, True), daily_shape(hours, False))
        out = cap * peak * shape * rng.normal(1.0, 0.02, len(times))   # 평소는 차분하게 (잡음 작게)
        inn = cap * peak * 0.35 * shape * rng.normal(1.0, 0.025, len(times))
        ref_out, ref_in = cap * peak, cap * peak * 0.35

        for eid, _n, _k, links, _exp, actual in MATCHES:
            if name in links:   # 경기가 더하는 트래픽 = 평소 피크 x (배율-1) x 시청 곡선
                out = out + ref_out * (actual - 1) * prof5[eid] * rng.normal(1.0, 0.03, len(times))
                inn = inn + ref_in * (actual - 1) * 0.3 * prof5[eid]

        u_start, u_end, u_link, mult = UNPLANNED
        if name == u_link:
            mask = (times >= pd.Timestamp(u_start)) & (times <= pd.Timestamp(u_end))
            inn = np.where(mask, inn * mult * rng.normal(1.0, 0.08, len(times)), inn)

        for d_start, d_end, d_link, d_out, d_in, _why in DROPS:
            if name == d_link:
                mask = (times >= pd.Timestamp(d_start)) & (times <= pd.Timestamp(d_end))
                before = out.copy()
                out = np.where(mask, out * d_out, out)
                inn = np.where(mask, inn * d_in, inn)
                if name == SHIFT[0]:
                    lost = np.where(mask, before - out, 0.0)
        if name == SHIFT[1]:
            out = out + SHIFT[2] * lost

        out = np.clip(out, 0.1, cap)   # 회선 용량을 넘을 수는 없다
        inn = np.clip(inn, 0.05, cap)
        rows.append(pd.DataFrame({"time": times, "link": name,
                                  "in_gbps": inn.round(2), "out_gbps": out.round(2)}))

    pd.concat(rows).to_csv(OUT / "traffic.csv", index=False)
    pd.DataFrame([(n, d, c) for n, d, c, _ in LINKS],
                 columns=["link", "description", "capacity_gbps"]).to_csv(OUT / "links.csv", index=False)
    marks = ";".join(f"{k}:{a}-{b}" for k, a, b in MARKS)
    ev = []
    for eid, n, kick, links, exp, _a in MATCHES:   # 실제 배율은 숨김값이라 파일에 없다
        end = (pd.Timestamp(kick) + pd.Timedelta(minutes=LEN_MIN)).strftime("%Y-%m-%d %H:%M")
        ev.append((eid, n, kick, end, ",".join(links), exp, marks))
    pd.DataFrame(ev, columns=["event_id", "name", "start", "end", "links", "expected_factor", "marks"]
                 ).to_csv(OUT / "events.csv", index=False)
    write_server_room(times, hours)
    print("완료: traffic.csv", len(times) * len(LINKS), "행, 경기", len(MATCHES), "개")


if __name__ == "__main__":
    main()
