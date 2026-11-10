"""data/*.csv -> site/data.js (사이트가 읽는 데이터). 전부 가상 데이터."""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
t = pd.read_csv(ROOT / "data/traffic.csv", parse_dates=["time"])
links = pd.read_csv(ROOT / "data/links.csv")
events = pd.read_csv(ROOT / "data/events.csv")

start = t["time"].min()
out = {
    "start": start.strftime("%Y-%m-%dT%H:%M"),
    "stepMin": 5,
    "n": int(t[t.link == links.link[0]].shape[0]),
    "links": [],
    "events": [
        {"id": r.event_id, "name": r.name, "start": r.start.replace(" ", "T"),
         "end": r.end.replace(" ", "T"), "links": r.links.split(","),
         "expected": float(r.expected_factor),
         "kind": r.kind,
         "marks": [{"k": m.split(":")[0], "a": int(m.split(":")[1].split("-")[0]), "b": int(m.split(":")[1].split("-")[1])}
                   for m in (str(r.marks).split(";") if isinstance(r.marks, str) else [])]}
        for r in events.itertuples()
    ],
}
for r in links.itertuples():
    d = t[t.link == r.link].sort_values("time")
    out["links"].append({"id": r.link, "desc": r.description, "cap": int(r.capacity_gbps),
                         "in": d.in_gbps.round(2).tolist(), "out": d.out_gbps.round(2).tolist()})
temps = pd.read_csv(ROOT / "data/temps.csv")
devs = pd.read_csv(ROOT / "data/rack_devices.csv").fillna("")
out["racks"] = []
for rack, g in devs.groupby("rack", sort=False):
    out["racks"].append({
        "id": rack,
        "devices": [{"slot": int(r.slot), "id": r.device, "vendor": r.vendor, "fanWarn": bool(r.fan_warn),
                     "downStart": str(r.down_start).replace(" ", "T"), "downEnd": str(r.down_end).replace(" ", "T"), "downWhy": str(r.down_why)}
                    for r in g.itertuples()],
        "temp": temps[temps.rack == rack].sort_values("time").inlet_c.tolist(),
    })
(ROOT / "site/data.js").write_text("const DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
print("site/data.js 완료", out["n"], "점 x", len(out["links"]), "링크")
