// 탐지 결과를 JSON으로 내보낸다. 파이썬 교차 검증(tests/test_detection_crosscheck.py)이 읽는다.
const { loadData, Lib } = require('./helpers');
const data = loadData();
const traffic = Lib.detectTraffic(data).alerts.map(a => ({ link: a.link, kind: a.kind, s: a.s, e: a.e }));
const room = Lib.detectRoom(data.racks, Lib.TEMP_DEFAULTS).map(a => ({ rack: a.rack, s: a.s, e: a.e }));
process.stdout.write(JSON.stringify({ traffic, room }));
