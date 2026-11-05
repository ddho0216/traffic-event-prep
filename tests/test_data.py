"""가짜 데이터가 약속한 규칙을 지키는지 검사한다.

실행: python3 -m unittest discover -s tests -v
(먼저 python3 gen_data.py 로 data/ 를 만들어 둘 것)
"""
import hashlib
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
sys.path.insert(0, str(ROOT))
import gen_data  # noqa: E402


def load():
    t = pd.read_csv(DATA / "traffic.csv", parse_dates=["time"])
    links = pd.read_csv(DATA / "links.csv")
    ev = pd.read_csv(DATA / "events.csv", parse_dates=["start", "end"])
    t = t.merge(links, on="link")
    t["util"] = t.out_gbps / t.capacity_gbps
    return t, links, ev


class TrafficData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.t, cls.links, cls.ev = load()

    def test_row_count_and_no_missing(self):
        self.assertEqual(len(self.t), len(self.links) * gen_data.DAYS * 288)
        self.assertFalse(self.t[["in_gbps", "out_gbps"]].isna().any().any())

    def test_never_exceeds_capacity(self):
        self.assertTrue((self.t.out_gbps <= self.t.capacity_gbps).all())
        self.assertTrue((self.t.in_gbps <= self.t.capacity_gbps).all())

    def test_five_minute_steps(self):
        one = self.t[self.t.link == "OUR-A"].sort_values("time")
        self.assertTrue((one.time.diff().dropna() == pd.Timedelta(minutes=5)).all())

    def test_calm_days_stay_below_60_percent(self):
        calm = self.t[(self.t.time >= "2026-10-19") & (self.t.time < "2026-10-24")]
        self.assertLess(calm.util.max(), 0.60)

    def test_each_match_within_two_hours(self):
        for r in self.ev.itertuples():
            self.assertLessEqual((r.end - r.start).total_seconds() / 60, 120, r.name)

    def test_events_inside_data_range(self):
        lo, hi = self.t.time.min(), self.t.time.max()
        self.assertTrue((self.ev.start >= lo).all() and (self.ev.end <= hi).all())

    def test_some_match_crosses_warning_line(self):
        hit = False
        for r in self.ev.itertuples():
            w = self.t[(self.t.time >= r.start) & (self.t.time <= r.end) & self.t.link.isin(r.links.split(","))]
            hit = hit or (w.util >= 0.8).any()
        self.assertTrue(hit)

    def test_hydration_break_dips_and_recovers(self):
        r = self.ev.iloc[0]
        a = self.t[(self.t.link == "OUR-A")].set_index("time").out_gbps
        before = a[r.start + pd.Timedelta(minutes=20)]
        dip = a[r.start + pd.Timedelta(minutes=25)]
        after = a[r.start + pd.Timedelta(minutes=35)]
        self.assertLess(dip, before * 0.95)
        self.assertGreater(after, dip)

    def test_unplanned_in_spike_is_big(self):
        b = self.t[self.t.link == "OUR-B"].set_index("time").in_gbps
        normal = b[pd.Timestamp("2026-10-29 03:20") - pd.Timedelta(days=1)]
        self.assertGreater(b[pd.Timestamp("2026-10-29 03:20")], 3 * normal)

    def test_sudden_drop_scenarios(self):
        idx = self.t.set_index(["link", "time"])
        out, inn = idx.out_gbps, idx.in_gbps
        ts = pd.Timestamp
        # IX-1: 저녁 피크 중에 전날 같은 시각의 30%보다 낮다
        self.assertLess(out[("IX-1", ts("2026-10-23 20:30"))], 0.3 * out[("IX-1", ts("2026-10-22 20:30"))])
        # 빠진 트래픽의 일부를 INTL-1이 더 받는다
        self.assertGreater(out[("INTL-1", ts("2026-10-23 20:30"))], 1.15 * out[("INTL-1", ts("2026-10-22 20:30"))])
        # CTR-B1: in·out이 모두 거의 0 (회선 다운), 끝나면 돌아온다
        self.assertLess(out[("CTR-B1", ts("2026-10-21 14:30"))], 1.0)
        self.assertLess(inn[("CTR-B1", ts("2026-10-21 14:30"))], 1.0)
        self.assertGreater(out[("CTR-B1", ts("2026-10-21 15:00"))], 5)

    def test_same_seed_gives_same_data(self):
        def digest():
            return hashlib.sha256((DATA / "traffic.csv").read_bytes()).hexdigest()
        before = digest()
        gen_data.main()
        self.assertEqual(before, digest())


class ServerRoomData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temps = pd.read_csv(DATA / "temps.csv", parse_dates=["time"])
        cls.servers = pd.read_csv(DATA / "servers.csv")

    def test_counts(self):
        self.assertEqual(self.temps.rack.nunique(), 6)
        self.assertEqual(len(self.servers), 24)

    def test_normal_racks_stay_below_27(self):
        normal = self.temps[self.temps.rack != "A-03"]
        self.assertLess(normal.inlet_c.max(), 27)

    def test_cooling_incident_only_in_a03(self):
        a03 = self.temps[self.temps.rack == "A-03"].set_index("time").inlet_c
        self.assertGreaterEqual(a03["2026-10-26 15:55"], 33)
        self.assertLess(a03["2026-10-27 12:00"], 27)

    def test_one_server_down_and_one_disk_warning(self):
        self.assertEqual(self.servers.hdd_warn.sum(), 1)
        self.assertEqual(self.servers.down_start.notna().sum(), 1)


if __name__ == "__main__":
    unittest.main()
