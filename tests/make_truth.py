"""정답표 만들기: 데이터에 "일부러 심은 사건"을 정답으로 적는다.

데이터 생성 코드(gen_data.py)의 사건 정의에서 그대로 가져오므로, 데이터와 정답표가 어긋나지 않는다.
만드는 파일:
  tests/ground_truth.json   - 테스트가 읽는 정답표
  docs/ground_truth.md      - 사람이 검토하는 정답표 (은호님이 "현업에서도 알림이었나"를 표시)

실행: python3 tests/make_truth.py
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import gen_data as g  # noqa: E402


def fmt(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%d %H:%M")


def build() -> dict:
    must = []
    for i, (s, e, link, _fo, _fi, why) in enumerate(g.DROPS, 1):
        must.append({"id": f"DROP{i}", "link": link, "kind_any": ["in·out 동시 급감"], "start": fmt(s), "end": fmt(e), "why": why})
    s, e, link, _mult = g.UNPLANNED
    must.append({"id": "SPIKE1", "link": link, "kind_any": ["in 급증 의심"], "start": fmt(s), "end": fmt(e), "why": "새벽 in 트래픽 급증 (DDoS 의심)"})

    room = [{"id": "COOL1", "rack": g.COOLING[0], "start": fmt(g.COOLING[1]), "end": fmt(g.COOLING[4]),
             "min_peak_c": 33, "why": "냉각 이상으로 랙 입구 온도 상승"}]

    noise = []
    for eid, name, kick, links, _exp, _act in g.MATCHES:
        end = pd.Timestamp(kick) + pd.Timedelta(minutes=g.LEN_MIN)
        noise.append({"id": eid, "name": name, "start": fmt(kick), "end": fmt(end), "links": links})

    info = {
        "server_down": {"server": f"{g.SERVER_DOWN[0]}_S{g.SERVER_DOWN[1]}", "start": fmt(g.SERVER_DOWN[2]), "end": fmt(g.SERVER_DOWN[3]),
                        "why": "과열로 서버 한 대가 꺼짐 (LED로 확인)"},
        "hdd_warn": {"server": f"{g.HDD_WARN[0]}_S{g.HDD_WARN[1]}", "why": "디스크 경고가 계속 켜져 있음 (교체 대기 가정)"},
    }
    return {
        "version": 1,
        "tolerance_min": 10,     # 알림 시작·끝이 정답 구간에서 이 시간 넘게 벗어나면 "다른 것"으로 본다
        "tag_before_min": 30,    # 경기 시작 이 시간 전부터 "경기와 겹침"
        "tag_after_min": 20,     # 경기 끝난 뒤 이 시간까지
        "must_alert": must,
        "must_alert_room": room,
        "expected_noise": noise,
        "info": info,
        "decisions": [
            {"q": "경기 중 in이 평소의 3배로 오르는 것은 알림인가?",
             "a": "알림이 맞다. 3배는 현업에서도 알림이었고 경계(간당간당) 수준이었다. 경기 겹침 표시는 원인 표시일 뿐 소음이 아니다. (은호님 답변, 2026-11-05)"},
        ],
    }


def markdown(t: dict) -> str:
    L = ["# 정답표 (가상 데이터에 일부러 심은 사건)", "",
         "이 표가 \"탐지가 맞았는지\"를 재는 기준입니다. 데이터 생성 코드에서 자동으로 만들었습니다. 모든 이름·시각·수치는 가상입니다.", "",
         "## 1. 알림이 떠야 하는 사건 (확인 필요)", "",
         "| 번호 | 링크 | 시작 | 끝 | 잡아야 할 유형 | 설명 | 현업에서도 알림이었나 (은호님 표시) |",
         "| --- | --- | --- | --- | --- | --- | --- |"]
    for m in t["must_alert"]:
        L.append(f"| {m['id']} | {m['link']} | {m['start']} | {m['end']} | {', '.join(m['kind_any'])} | {m['why']} | ☐ 예 ☐ 아니오 |")
    for r in t["must_alert_room"]:
        L.append(f"| {r['id']} | 랙 {r['rack']} | {r['start']} | {r['end']} | 온도 경고(30°C 이상), 최고 {r['min_peak_c']}°C 이상 | {r['why']} | ☐ 예 ☐ 아니오 |")
    L += ["", "## 2. 경기와 겹치는 알림 (알림은 맞지만 원인이 경기일 가능성이 높아 표시를 붙인다)", "",
          f"경기 시작 {t['tag_before_min']}분 전부터 끝난 뒤 {t['tag_after_min']}분까지 나오는 알림은 경기 때문이라고 표시합니다.", "",
          "| 번호 | 경기 | 킥오프 | 종료 | 영향 링크 |", "| --- | --- | --- | --- | --- |"]
    for n in t["expected_noise"]:
        L.append(f"| {n['id']} | {n['name']} | {n['start']} | {n['end']} | {', '.join(n['links'])} |")
    L += ["", "## 3. 알림은 아니지만 화면(LED)으로 보이는 것", "",
          f"- 서버 꺼짐: {t['info']['server_down']['server']}, {t['info']['server_down']['start']} ~ {t['info']['server_down']['end']} ({t['info']['server_down']['why']})",
          f"- 디스크 경고: {t['info']['hdd_warn']['server']} ({t['info']['hdd_warn']['why']})",
          "", "## 4. 합격 기준", "",
          "- 1번 사건을 전부 잡는다 (놓침 0)",
          "- 1번과 2번이 아닌 \"확인 필요\" 알림이 없다 (오탐 0)",
          "- 알림 시작이 정답 시작에서 15분 이내로 늦지 않는다",
          "", "## 5. 결정된 것", ""]
    for d in t["decisions"]:
        L += [f"- 질문: {d['q']}", f"  - 답: {d['a']}"]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    truth = build()
    (ROOT / "tests/ground_truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs/ground_truth.md").write_text(markdown(truth), encoding="utf-8")
    print("만들었습니다: tests/ground_truth.json, docs/ground_truth.md")
