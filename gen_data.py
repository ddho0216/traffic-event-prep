"""가짜 백본 트래픽 데이터 만들기 (전부 가상 데이터).

만드는 파일 (data/ 폴더):
  links.csv    - 링크 15개와 회선 용량(Gbps)
  events.csv   - 아시안게임 일정에 맞춘 가상 이벤트 8개와 "예상 배율", 경기 중 표시 구간(marks)
  temps.csv    - 서버실 랙 6개의 입구 온도(5분 간격), 냉각 이상 사례 1건
  servers.csv  - 서버 24대 (역할, 디스크 경고, 꺼짐 시간)
  traffic.csv  - 5분 간격 in/out (Gbps), 53일치 (9/10~11/01)

실제 회사·센터·회선 수치는 쓰지 않았다. 이벤트 일정은 제20회 아이치·나고야 아시안게임(2026-09-19~10-04)을 참고했지만 트래픽 숫자는 모두 지어낸 것이다.
같은 seed면 항상 같은 데이터가 나온다.
"""
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
OUT = Path(__file__).parent / "data"
START = "2026-09-10 00:00"   # 목요일. 아시안게임 개회식(9/19) 전 주(9/12)가 "전주" 비교에 쓰이도록 9/10부터 시작
DAYS = 53   # 9/10 ~ 11/01
STEP = "5min"

# 링크: 이름, 설명, 용량(Gbps), 평소 저녁 피크 사용률(out 기준)
LINKS = [
    ("IDC_B_FS1_UP1", "분당 → 중앙 백본 (A)", 100, 0.45),
    ("IDC_B_FS1_UP2", "분당 → 중앙 백본 (B)", 100, 0.30),
    ("IDC_A_FS1_UP1", "안산 → 중앙 백본 (Juniper)", 100, 0.40),
    ("IDC_A_FR1_UP1", "안산 → 중앙 백본 (Cisco)", 100, 0.25),
    ("IDC_G_FS1_UP1", "구로 → 중앙 백본", 200, 0.35),
    ("IDC_S_FR1_UP1", "서초 센터 백본 (Cisco)", 400, 0.40),
    ("IDC_B_FS2_IX1", "국내 연동(IX)", 100, 0.38),
    ("IDC_B_FS2_INTL1", "해외 연동", 100, 0.28),
    # 서초 중앙 백본을 거쳐 분당으로 들어오는 트래픽 (용량 200G는 임시값: 장비 수용량을 알아본 뒤 다시 정할 것)
    ("IDC_S_FS2_TOB1", "서초 → 분당 (서초를 거쳐 들어오는 트래픽)", 200, 0.60),
    # 큰 고객사 전용 회선 6개 (서초 2, 분당 2, 구로 1, 안산 1). 용량과 피크 비율은 제가 정한 가정: 고객사 트래픽이 많은 쪽으로 피크 사용률 60~70%
    ("IDC_S_FR1_BIG1", "서초 큰 고객사 1 전용 (가상스트림)", 200, 0.70),
    ("IDC_S_FR1_BIG2", "서초 큰 고객사 2 전용 (시험데이터)", 100, 0.65),
    ("IDC_B_FS1_BIG1", "분당 큰 고객사 1 전용 (샘플비디오)", 200, 0.65),
    ("IDC_B_FS1_BIG2", "분당 큰 고객사 2 전용 (데모포털)", 100, 0.70),
    ("IDC_G_FS1_BIG1", "구로 큰 고객사 전용 (예제게임월드)", 100, 0.70),
    ("IDC_A_FS1_BIG1", "안산 큰 고객사 전용 (모의OTT)", 100, 0.60),
]

# 이벤트 한 번의 길이(분)와 종류. 축구 경기는 킥오프~종료 115분(전반 47 + 하프타임 15 + 후반 약 53)이라 2시간을 넘지 않는다.
LEN_MIN = 115   # 축구 경기 길이 (이전 이름 호환)
# 경기 중 표시 구간(축구만): (종류, 킥오프 후 시작분, 끝분). 하이드레이션 타임은 전·후반 중간쯤 약 3분(가상).
MARKS = [("hydration", 25, 28), ("halftime", 47, 62), ("hydration", 87, 90)]
A3 = ["IDC_B_FS1_UP1", "IDC_A_FS1_UP1", "IDC_B_FS2_IX1"]
# 이벤트: 제20회 아이치·나고야 아시안게임(2026-09-19~10-04)에 맞춘 가상 트래픽 이벤트. 트래픽 수치는 전부 가상이다.
#  검색으로 확인한 것: 대회 기간(9/19~10/4), 개회식 9/19 저녁 6시 시작, 야구 조별리그 9/21 시작(한국-대만)
#  확인하지 못한 것(제가 정한 가정): 개회식 길이, 폐회식 시각, 야구 경기 시각, 축구·e스포츠·야구 결승의 날짜와 시각
# id, 이름, 시작, 영향 링크, 예상 배율(고객사에 알린 값), 실제 배율(숨김값)
MATCHES = [
    ("EV1", "개회식", "2026-09-19 18:00", A3, 1.6, 1.7),
    ("EV2", "야구 한국-대만", "2026-09-21 18:00", A3, 1.4, 1.5),
    ("EV3", "축구 8강", "2026-09-27 20:00", A3, 1.5, 1.65),
    ("EV4", "축구 4강", "2026-09-30 20:00", A3 + ["IDC_B_FS1_UP2"], 1.6, 1.85),
    ("EV5", "축구 결승", "2026-10-02 20:00", A3 + ["IDC_B_FS1_UP2", "IDC_G_FS1_UP1"], 1.8, 2.0),
    ("EV6", "e스포츠 결승", "2026-10-03 15:00", A3 + ["IDC_B_FS1_UP2"], 1.5, 1.7),
    ("EV7", "야구 결승", "2026-10-03 19:00", A3 + ["IDC_B_FS1_UP2"], 1.7, 1.9),
    ("EV8", "폐회식", "2026-10-04 18:00", A3 + ["IDC_B_FS1_UP2"], 1.6, 1.75),
]
EVENT_META = {   # 종류: ceremony(개·폐회식), match(축구: 하프타임 있음), game(야구·e스포츠: 하프타임 없음), 길이(분)
    "EV1": {"kind": "ceremony", "len": 180}, "EV2": {"kind": "game", "len": 150}, "EV3": {"kind": "match", "len": 115},
    "EV4": {"kind": "match", "len": 115}, "EV5": {"kind": "match", "len": 115}, "EV6": {"kind": "game", "len": 150},
    "EV7": {"kind": "game", "len": 150}, "EV8": {"kind": "ceremony", "len": 150},
}

# 예고 없던 일: 새벽 in 트래픽 급증(DDoS 의심). 경기 없는 날 새벽.
UNPLANNED = ("2026-10-29 03:10", "2026-10-29 03:35", "IDC_B_FS1_UP2", 6.0)

# 갑자기 빠지는 일(급감): 정상 운영 중 트래픽이 평소보다 크게 줄어든다.
# 시작, 끝, 링크, 남는 비율(out), 남는 비율(in), 설명
DROPS = [
    ("2026-10-23 20:10", "2026-10-23 20:55", "IDC_B_FS2_IX1", 0.15, 0.15, "연동 회선 장애로 우회 (저녁 피크 중)"),
    ("2026-10-21 14:20", "2026-10-21 14:45", "IDC_A_FS1_UP1", 0.02, 0.02, "회선 다운 (in·out 모두 거의 0)"),
]
# IDC_B_FS2_IX1에서 빠진 트래픽의 60%가 IDC_B_FS2_INTL1로 돌아간다 (한쪽이 빠지면 다른 쪽이 튄다)
SHIFT = ("IDC_B_FS2_IX1", "IDC_B_FS2_INTL1", 0.6)

# 서버실: 센터마다 랙이 있고, 랙에는 네트워크 장비만 들어간다. 랙 입구 온도(inlet)를 5분 간격으로 만든다. 전부 가상.
# 센터별 장비 수(사용자가 정한 값): FR = Cisco, FS = Juniper, AS = Huawei
COUNTS = {"B": {"FR": 4, "FS": 8, "AS": 10}, "S": {"FR": 6, "FS": 12, "AS": 30},
          "G": {"FR": 2, "FS": 4, "AS": 20}, "A": {"FR": 4, "FS": 10, "AS": 10}}
# 랙 규칙: Cisco 대형은 랙당 1대, Juniper는 랙당 최대 2대 (사용자가 알려 준 값). Huawei는 소형이라 랙당 최대 8대 (제가 정한 가정)
PER_RACK = {"FR": 1, "FS": 2, "AS": 8}
VENDOR = {"FR": "cisco", "FS": "juniper", "AS": "huawei"}


def build_rack_devices() -> dict:
    """랙마다 들어 있는 장비. 이중화 짝(FS1-FS2 ...)은 서로 다른 랙에 둔다 (한쪽 전기가 나가도 반대쪽이 살려 주도록).
    A측 랙에는 짝의 홀수 번호 장비, B측 랙에는 짝수 번호 장비. 랙 번호는 Cisco 랙, Juniper 랙, Huawei 랙 순서.
    site/topology.js와 같은 규칙 (tests가 같은지 확인한다)."""
    racks: dict = {}
    for c, n in COUNTS.items():
        n_fs_racks = 2 * -(-(-(-n["FS"] // 2)) // PER_RACK["FS"])
        for k in ("FR", "FS", "AS"):
            for i in range(1, n[k] + 1):
                if k == "FR":
                    r = i
                else:
                    grp = -(-(-(-i // 2)) // PER_RACK[k])
                    side = 1 if i % 2 else 2
                    r = (n["FR"] if k == "FS" else n["FR"] + n_fs_racks) + 2 * (grp - 1) + side
                racks.setdefault(f"IDC_{c}_R{r:02d}", []).append(f"IDC_{c}_{k}{i}")
    return racks


RACK_DEVICES = build_rack_devices()
RACKS = list(RACK_DEVICES)
CENTER_TEMP_OFFSET = {"B": 0.0, "S": 0.4, "G": -0.2, "A": 0.1}   # 센터마다 평소 온도가 조금씩 다르다
# 냉각 이상: 분당 IDC_B_R08 랙(IDC_B_FS6·FS8이 든 B측 랙. 짝 장비 FS5는 다른 랙 R07이라 영향 없음), 14:30에 오르기 시작 -> 15:30 최고 -> 16:30까지 유지 -> 17:15에 복구
COOLING = ("IDC_B_R08", "2026-10-26 14:30", "2026-10-26 15:30", "2026-10-26 16:30", "2026-10-26 17:15", 11.5)
# 장비가 꺼진 사건 (장비, 시작, 끝, 원인). 전부 가상.
#  1) IDC_B_FS6: 냉각 이상으로 과열 보호 종료, 16:05~16:25 (짝 장비 IDC_B_FS5는 다른 랙(R07)에 있어 살아 있음)
#  2) IDC_B_FS7: 전원 모듈 고장(가정)으로 꺼짐, 새벽 03:10~03:50. 짝 장비 IDC_B_FS8이 같은 고객 회선을 받아서 큰 장애 없이 넘어간다 (이중화 시나리오)
DEVICE_DOWNS = [
    ("IDC_B_FS6", "2026-10-26 16:05", "2026-10-26 16:25", "과열 보호 종료"),
    ("IDC_B_FS7", "2026-10-27 03:10", "2026-10-27 03:50", "전원 모듈 고장(가정)"),
]
DEVICE_DOWN = DEVICE_DOWNS[0][:3]   # 이전 이름 호환
# 팬 경고가 계속 켜져 있는 장비(교체 대기): IDC_B_FS4
FAN_WARN = "IDC_B_FS4"


def daily_shape(hours: np.ndarray, weekend: bool) -> np.ndarray:
    """평소 하루 모양: 새벽 낮음, 저녁 피크. 0~1 사이 값."""
    base = 0.25 + 0.15 * np.sin((hours - 9) / 24 * 2 * np.pi)
    evening = 0.65 * np.exp(-((hours - 21) ** 2) / (2 * 2.2**2))
    shape = base + evening
    if weekend:  # 주말은 낮이 더 높고 피크가 약간 넓다
        shape = shape + 0.10 * np.exp(-((hours - 14) ** 2) / (2 * 3.0**2))
    return shape / shape.max()


def match_profile(k: int, kind: str = "match", length: int = LEN_MIN):
    """이벤트 하나의 시청 곡선(0~1). 1분 단위. m = 시작 기준 분. kind: match(축구), game(야구·e스포츠), ceremony(개·폐회식)"""
    rng = np.random.default_rng(SEED + k)
    m = np.arange(-60, length + 31)
    p = np.zeros(len(m))
    for i, x in enumerate(m):
        if kind == "match":
            if x < -30:
                v = 0.0
            elif x < 0:
                v = 0.85 * (x + 30) / 30                    # 킥오프 30분 전부터 상승
            elif x < 47:
                v = 0.92 + 0.08 * max(0, 5 - x) / 5         # 전반: 초반이 가장 높음
            elif x < 62:
                v = 0.55                                    # 하프타임: 트래픽이 빠진다
            elif x <= length:
                v = 0.95 + 0.05 * (x - 62) / (length - 62)  # 후반: 종료 쪽으로 갈수록 높음
            else:
                v = 0.30 * np.exp(-(x - length) / 6)        # 종료 직후 급락, 짧은 꼬리
        elif kind == "ceremony":
            if x < -45:
                v = 0.0
            elif x < 0:
                v = 0.80 * (x + 45) / 45                    # 시작 45분 전부터 천천히 상승
            elif x <= length:
                v = 0.85 + 0.15 * np.sin(np.pi * x / length)   # 입장 행사·공연이 이어지며 중간이 가장 높음
            else:
                v = 0.30 * np.exp(-(x - length) / 8)        # 끝난 뒤 완만하게 빠진다
        else:   # game: 야구·e스포츠. 하프타임은 없고 쉬는 시간(약 2분)이 가끔 있다
            if x < -30:
                v = 0.0
            elif x < 0:
                v = 0.80 * (x + 30) / 30
            elif x <= length:
                v = 0.90 + 0.06 * np.sin(x / 17.0)
                if x % 25 in (23, 24):
                    v *= 0.82
            else:
                v = 0.30 * np.exp(-(x - length) / 6)
        p[i] = v
    if kind == "match":
        for mk, a, b in MARKS:
            if mk == "hydration":
                p[(m >= a) & (m < b)] *= 0.65               # 쭉 빠졌다가 다시 들어온다
        goal_pool = np.r_[np.arange(5, 22), np.arange(30, 45), np.arange(66, 84), np.arange(92, 108)]
        for gl in rng.choice(goal_pool, 2, replace=False):  # 골 장면: 잠깐 3분 +10%
            p[(m >= gl) & (m < gl + 3)] *= 1.10
    return m, p


def write_server_room(times: pd.DatetimeIndex, hours: np.ndarray) -> None:
    """랙 입구 온도(temps.csv)와 랙 안 장비 목록(rack_devices.csv)을 만든다."""
    rng = np.random.default_rng(SEED + 100)   # 트래픽 난수와 분리 (트래픽 데이터는 그대로)
    shape = daily_shape(hours, False)
    tm = np.asarray((times - times[0]) / pd.Timedelta(minutes=1))
    mins = lambda ts: (pd.Timestamp(ts) - times[0]) / pd.Timedelta(minutes=1)
    rows = []
    for rack in RACKS:
        code, local = rack.split("_")[1], (int(rack.split("_R")[1]) - 1) % 6   # 센터 코드, 센터 안 번호(0부터)
        temp = 21.5 + 0.3 * local + CENTER_TEMP_OFFSET[code] + 1.5 * shape + rng.normal(0, 0.12, len(times))
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

    dev = []
    for rack, devs in RACK_DEVICES.items():
        for slot, name in enumerate(devs, 1):
            vendor = VENDOR[name.split("_")[2][:2]]
            down = next((x for x in DEVICE_DOWNS if x[0] == name), None)
            dev.append((rack, slot, name, vendor, int(name == FAN_WARN),
                        down[1] if down else "", down[2] if down else "", down[3] if down else ""))
    pd.DataFrame(dev, columns=["rack", "slot", "device", "vendor", "fan_warn", "down_start", "down_end", "down_why"]
                 ).to_csv(OUT / "rack_devices.csv", index=False)


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
        m, p = match_profile(k, EVENT_META[eid]["kind"], EVENT_META[eid]["len"])
        minute = np.zeros(DAYS * 1440)
        kick_min = int((pd.Timestamp(kick) - t0).total_seconds() / 60)
        idx = kick_min + m
        ok = (idx >= 0) & (idx < len(minute))
        minute[idx[ok]] = p[ok]
        prof5[eid] = minute.reshape(-1, 5).mean(axis=1)

    lost = np.zeros(len(times))   # IDC_B_FS2_IX1에서 빠진 양 (IDC_B_FS2_INTL1이 이어서 받는다)
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
        meta = EVENT_META[eid]
        end = (pd.Timestamp(kick) + pd.Timedelta(minutes=meta["len"])).strftime("%Y-%m-%d %H:%M")
        ev.append((eid, n, kick, end, ",".join(links), exp, marks if meta["kind"] == "match" else "", meta["kind"]))
    pd.DataFrame(ev, columns=["event_id", "name", "start", "end", "links", "expected_factor", "marks", "kind"]
                 ).to_csv(OUT / "events.csv", index=False)
    write_server_room(times, hours)
    print("완료: traffic.csv", len(times) * len(LINKS), "행, 경기", len(MATCHES), "개")


if __name__ == "__main__":
    main()
