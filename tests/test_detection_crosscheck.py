"""교차 검증: 사이트의 탐지 결과(JavaScript)를 파이썬으로 따로 다시 계산한 결과와 비교한다.

두 언어로 따로 짠 계산이 같은 답을 내면, 한쪽의 실수를 다른 쪽이 잡아 준다.
정답표가 최신인지(데이터 생성 코드와 어긋나지 않는지)도 함께 확인한다.
실행: python3 -m unittest discover -s tests -v   (node가 있어야 교차 검증이 돈다)
"""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
sys.path.insert(0, str(ROOT / "tests"))
import make_truth  # noqa: E402

PER_DAY = 288
# 규칙 (lib.js DEFAULTS와 같은 값, 여기서는 따로 적는다)
USAGE, SPIKE, DROP_RATIO, DROP_MIN = 0.8, 3.0, 0.4, 3
HOT = 30.0


def runs(flags):
    out, s = [], -1
    for i, f in enumerate(flags):
        if f and s < 0:
            s = i
        if not f and s >= 0:
            out.append((s, i - 1))
            s = -1
    if s >= 0:
        out.append((s, len(flags) - 1))
    return out


def upper_median_by_slot(a):
    """하루 중 같은 시각끼리의 중앙값. 개수가 짝수면 위쪽 값 (사이트와 같은 정의)."""
    days = len(a) // PER_DAY
    s = np.sort(a.reshape(days, PER_DAY), axis=0)
    return np.tile(s[days // 2], days)


def recompute_traffic():
    t = pd.read_csv(DATA / "traffic.csv", parse_dates=["time"])
    links = pd.read_csv(DATA / "links.csv")
    res = set()
    for r in links.itertuples():
        d = t[t.link == r.link].sort_values("time")
        out, inn = d.out_gbps.to_numpy(), d.in_gbps.to_numpy()
        for a, b in runs(out >= r.capacity_gbps * USAGE):
            res.add((r.link, "사용률 80%+", a, b))
        mi, mo = upper_median_by_slot(inn), upper_median_by_slot(out)
        for a, b in runs(inn >= SPIKE * mi):
            res.add((r.link, "in 급증 의심", a, b))
        d_out, d_in = out < DROP_RATIO * mo, inn < DROP_RATIO * mi
        for kind, flags in (("in·out 동시 급감", d_out & d_in), ("out 급감", d_out & ~d_in), ("in 급감", d_in & ~d_out)):
            for a, b in runs(flags):
                if b - a >= DROP_MIN - 1:
                    res.add((r.link, kind, a, b))
    return res


def recompute_room():
    temps = pd.read_csv(DATA / "temps.csv", parse_dates=["time"])
    res = set()
    for rack, g in temps.groupby("rack"):
        for a, b in runs(g.sort_values("time").inlet_c.to_numpy() >= HOT):
            res.add((rack, a, b))
    return res


@unittest.skipIf(shutil.which("node") is None, "node가 없어서 교차 검증을 건너뜀")
class CrossCheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", str(ROOT / "tests/dump_alerts.js")], capture_output=True, text=True, check=True).stdout
        cls.js = json.loads(out)

    def test_traffic_alerts_match_independent_python(self):
        js = {(a["link"], a["kind"], a["s"], a["e"]) for a in self.js["traffic"]}
        py = recompute_traffic()
        self.assertEqual(js - py, set(), "JavaScript에만 있는 알림")
        self.assertEqual(py - js, set(), "파이썬에만 있는 알림")
        self.assertGreater(len(js), 0)

    def test_room_alerts_match_independent_python(self):
        js = {(a["rack"], a["s"], a["e"]) for a in self.js["room"]}
        self.assertEqual(js, recompute_room())


class TruthIsFresh(unittest.TestCase):
    def test_ground_truth_json_matches_generator(self):
        on_disk = json.loads((ROOT / "tests/ground_truth.json").read_text(encoding="utf-8"))
        self.assertEqual(on_disk, make_truth.build(), "정답표가 오래됨: python3 tests/make_truth.py 로 다시 만드세요")

    def test_ground_truth_markdown_matches_generator(self):
        md = (ROOT / "docs/ground_truth.md").read_text(encoding="utf-8")
        self.assertEqual(md, make_truth.markdown(make_truth.build()), "정답표 문서가 오래됨: python3 tests/make_truth.py")


if __name__ == "__main__":
    unittest.main()
