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
        one = self.t[self.t.link == "IDC_B_FS1_UP1"].sort_values("time")
        self.assertTrue((one.time.diff().dropna() == pd.Timedelta(minutes=5)).all())

    def test_calm_days_stay_below_60_percent(self):
        """기존 회선은 평소에 60% 아래. 큰 고객사 전용 회선과 서초→분당 회선은 일부러 트래픽을 크게 해서 60~70%대이되 경고선 80%는 넘지 않는다."""
        calm = self.t[(self.t.time >= "2026-10-19") & (self.t.time < "2026-10-24")]
        big = calm.link.str.contains("BIG|TOB1")
        self.assertLess(calm[~big].util.max(), 0.60)
        self.assertLess(calm[big].util.max(), 0.80)
        self.assertGreater(calm[big].util.max(), 0.60)

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
        a = self.t[(self.t.link == "IDC_B_FS1_UP1")].set_index("time").out_gbps
        before = a[r.start + pd.Timedelta(minutes=20)]
        dip = a[r.start + pd.Timedelta(minutes=25)]
        after = a[r.start + pd.Timedelta(minutes=35)]
        self.assertLess(dip, before * 0.95)
        self.assertGreater(after, dip)

    def test_unplanned_in_spike_is_big(self):
        b = self.t[self.t.link == "IDC_B_FS1_UP2"].set_index("time").in_gbps
        normal = b[pd.Timestamp("2026-10-29 03:20") - pd.Timedelta(days=1)]
        self.assertGreater(b[pd.Timestamp("2026-10-29 03:20")], 3 * normal)

    def test_sudden_drop_scenarios(self):
        idx = self.t.set_index(["link", "time"])
        out, inn = idx.out_gbps, idx.in_gbps
        ts = pd.Timestamp
        # IDC_B_FS2_IX1: 저녁 피크 중에 전날 같은 시각의 30%보다 낮다
        self.assertLess(out[("IDC_B_FS2_IX1", ts("2026-10-23 20:30"))], 0.3 * out[("IDC_B_FS2_IX1", ts("2026-10-22 20:30"))])
        # 빠진 트래픽의 일부를 IDC_B_FS2_INTL1이 더 받는다
        self.assertGreater(out[("IDC_B_FS2_INTL1", ts("2026-10-23 20:30"))], 1.15 * out[("IDC_B_FS2_INTL1", ts("2026-10-22 20:30"))])
        # IDC_A_FS1_UP1: in·out이 모두 거의 0 (회선 다운), 끝나면 돌아온다
        self.assertLess(out[("IDC_A_FS1_UP1", ts("2026-10-21 14:30"))], 1.0)
        self.assertLess(inn[("IDC_A_FS1_UP1", ts("2026-10-21 14:30"))], 1.0)
        self.assertGreater(out[("IDC_A_FS1_UP1", ts("2026-10-21 15:00"))], 5)

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
        cls.devs = pd.read_csv(DATA / "rack_devices.csv")

    def test_counts(self):
        self.assertEqual(self.temps.rack.nunique(), 44)
        self.assertEqual(len(self.devs), 120)
        for v, n in {"cisco": 16, "juniper": 34, "huawei": 70}.items():
            self.assertEqual(self.devs.vendor.eq(v).sum(), n, v)

    def test_racks_per_center_and_naming(self):
        racks = sorted(self.temps.rack.unique())
        for code, n in {"B": 10, "S": 16, "G": 7, "A": 11}.items():
            mine = [r for r in racks if r.startswith(f"IDC_{code}_R")]
            self.assertEqual(len(mine), n, code)
        self.assertTrue(all(__import__("re").fullmatch(r"IDC_[BSGA]_R\d\d", r) for r in racks))
        for row in self.devs.itertuples():
            self.assertEqual(row.device.split("_")[1], row.rack.split("_")[1], row.device)   # 장비와 랙의 센터 코드가 같다
            self.assertEqual(row.vendor, {"FR": "cisco", "FS": "juniper", "AS": "huawei"}[row.device.split("_")[2][:2]])

    def test_rack_capacity_rule(self):
        """Cisco 대형은 랙을 혼자 쓰고, Juniper는 랙당 최대 2대, Huawei는 랙당 최대 8대(가정)."""
        cap = {"cisco": 1, "juniper": 2, "huawei": 8}
        for rack, g in self.devs.groupby("rack"):
            self.assertEqual(g.vendor.nunique(), 1, f"{rack}: 제조사가 섞임")
            self.assertLessEqual(len(g), cap[g.vendor.iloc[0]], f"{rack}: 용량 초과")
        self.assertEqual(self.devs.device.nunique(), len(self.devs), "한 장비는 랙 하나에만")

    def test_normal_racks_stay_below_27(self):
        normal = self.temps[self.temps.rack != "IDC_B_R07"]
        self.assertLess(normal.inlet_c.max(), 27)

    def test_cooling_incident_only_in_b03(self):
        b03 = self.temps[self.temps.rack == "IDC_B_R07"].set_index("time").inlet_c
        self.assertGreaterEqual(b03["2026-10-26 15:55"], 33)
        self.assertLess(b03["2026-10-27 12:00"], 27)

    def test_two_device_downs_and_one_fan_warning(self):
        self.assertEqual(self.devs.fan_warn.sum(), 1)
        down = self.devs[self.devs.down_start.notna()].set_index("device")
        self.assertEqual(sorted(down.index), ["IDC_B_FS6", "IDC_B_FS7"])
        self.assertEqual(down.loc["IDC_B_FS6", "rack"], "IDC_B_R07")   # 냉각 이상이 난 랙 안의 장비
        self.assertTrue(down.down_why.notna().all())

    def test_downed_device_has_alive_partner(self):
        """이중화: 꺼진 장비의 짝(홀수-짝수) 장비는 같은 시간에 꺼져 있지 않다."""
        down = self.devs[self.devs.down_start.notna()]
        for r in down.itertuples():
            n = int(r.device.split("_")[2][2:]); base = r.device.rsplit(str(n), 1)[0]
            partner = f"{base}{n + 1 if n % 2 else n - 1}"
            row = self.devs[self.devs.device == partner].iloc[0]
            self.assertTrue(row.down_start != row.down_start or row.down_start == "" or pd.isna(row.down_start), partner)


if __name__ == "__main__":
    unittest.main()
