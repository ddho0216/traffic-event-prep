/* 설계도 (가상): 어떤 장비가 있고 어떻게 연결되는지. 제가 만든 초안이며 모든 이름은 가상입니다.
   터미널의 장비 목록과 포트가 이 표에서 만들어집니다. 고치면 화면에 그대로 반영됩니다.
   - devices: 장비 (vendor: juniper / cisco / huawei)
   - links: 연결 (a장비 a포트 <-> b장비 b포트). b가 장비 목록에 없으면 외부(IX·해외 등). link는 그래프의 링크 이름.
   - faults: 포트에 심어 둔 이상 ("장비|포트": crc 오류 수, rx 광 수신값 dBm). 서버 포트 이상은 app.js에서 따로 둔다. */
(function (root, factory) {
  const t = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = t; else root.TOPOLOGY = t;
})(typeof self !== "undefined" ? self : this, function () {
  const devices = [
    // Juniper: 가장 많이 쓰는 주력 장비 (백본, 연동, 랙 ToR, CDN 연결)
    { id: "BB-OUR", vendor: "juniper", role: "우리 센터 백본", center: "우리 센터" },
    { id: "BB-EDGE", vendor: "juniper", role: "연동 장비 (IX·해외·CDN)", center: "우리 센터" },
    { id: "BB-B1", vendor: "juniper", role: "센터B 백본 1", center: "센터B" },
    { id: "BB-C1", vendor: "juniper", role: "센터C 백본", center: "센터C" },
    { id: "CDN-EDGE", vendor: "juniper", role: "CDN 연결 장비", center: "우리 센터" },
    { id: "SW-A-01", vendor: "juniper", role: "랙 ToR (A-01)", center: "우리 센터" },
    { id: "SW-A-02", vendor: "juniper", role: "랙 ToR (A-02)", center: "우리 센터" },
    { id: "SW-A-03", vendor: "juniper", role: "랙 ToR (A-03)", center: "우리 센터" },
    // Cisco: 비싸서 백본에만 몇 대
    { id: "BB-B2", vendor: "cisco", role: "센터B 백본 2", center: "센터B" },
    { id: "BB-D1", vendor: "cisco", role: "센터D 백본", center: "센터D" },
    // Huawei: 작은 장비가 많다 (B 랙 ToR, 소규모 접속 스위치)
    { id: "SW-B-01", vendor: "huawei", role: "랙 ToR (B-01)", center: "우리 센터" },
    { id: "SW-B-02", vendor: "huawei", role: "랙 ToR (B-02)", center: "우리 센터" },
    { id: "SW-B-03", vendor: "huawei", role: "랙 ToR (B-03)", center: "우리 센터" },
    { id: "AS-1", vendor: "huawei", role: "소규모 접속 스위치", center: "우리 센터" },
    { id: "AS-2", vendor: "huawei", role: "소규모 접속 스위치", center: "우리 센터" },
    { id: "AS-3", vendor: "huawei", role: "소규모 접속 스위치", center: "우리 센터" },
    { id: "AS-4", vendor: "huawei", role: "소규모 접속 스위치", center: "우리 센터" },
    { id: "AS-5", vendor: "huawei", role: "소규모 접속 스위치", center: "우리 센터" }
  ];

  const L = (link, a, ap, b, bp, kind, gbps) => ({ link, a, ap, b, bp, kind, gbps });
  const links = [
    // 백본 연결 (그래프에 나오는 링크). Juniper끼리, Juniper-Cisco가 섞여 있다.
    L("OUR-A", "BB-OUR", "xe-0/0/0", "BB-EDGE", "xe-0/0/0", "백본", 100),
    L("OUR-B", "BB-OUR", "xe-0/0/1", "BB-EDGE", "xe-0/0/1", "백본", 100),
    L("CTR-B1", "BB-OUR", "xe-0/0/2", "BB-B1", "xe-0/0/0", "센터 간 (Juniper-Juniper)", 100),
    L("CTR-B2", "BB-OUR", "xe-0/0/3", "BB-B2", "Te1/0/1", "센터 간 (Juniper-Cisco)", 100),
    L("CTR-C1", "BB-OUR", "xe-0/0/4", "BB-C1", "xe-0/0/0", "센터 간 (Juniper-Juniper)", 200),
    L("CTR-D1", "BB-OUR", "xe-0/0/5", "BB-D1", "Te1/0/1", "센터 간 (Juniper-Cisco)", 400),
    // 외부 연결 (상대는 장비 목록에 없음)
    L("IX-1", "BB-EDGE", "xe-0/0/2", "국내 IX", "-", "연동(IX)", 100),
    L("INTL-1", "BB-EDGE", "xe-0/0/3", "해외 사업자", "-", "해외 연동", 100),
    L("CDN-1", "BB-EDGE", "xe-0/0/4", "CDN-EDGE", "xe-0/0/0", "CDN 연결 (그래프 없음)", 100),
    // 랙 ToR와 소규모 스위치의 업링크
    L("UP-A-01", "BB-OUR", "xe-0/0/10", "SW-A-01", "xe-0/0/10", "랙 업링크", 10),
    L("UP-A-02", "BB-OUR", "xe-0/0/11", "SW-A-02", "xe-0/0/10", "랙 업링크", 10),
    L("UP-A-03", "BB-OUR", "xe-0/0/12", "SW-A-03", "xe-0/0/10", "랙 업링크", 10),
    L("UP-B-01", "BB-OUR", "xe-0/0/13", "SW-B-01", "XGigabitEthernet0/1/10", "랙 업링크", 10),
    L("UP-B-02", "BB-OUR", "xe-0/0/14", "SW-B-02", "XGigabitEthernet0/1/10", "랙 업링크", 10),
    L("UP-B-03", "BB-OUR", "xe-0/0/15", "SW-B-03", "XGigabitEthernet0/1/10", "랙 업링크", 10),
    L("UP-AS-1", "BB-OUR", "xe-0/0/16", "AS-1", "XGigabitEthernet0/1/1", "접속 업링크", 10),
    L("UP-AS-2", "BB-OUR", "xe-0/0/17", "AS-2", "XGigabitEthernet0/1/1", "접속 업링크", 10),
    L("UP-AS-3", "BB-OUR", "xe-0/0/18", "AS-3", "XGigabitEthernet0/1/1", "접속 업링크", 10),
    L("UP-AS-4", "BB-EDGE", "xe-0/0/10", "AS-4", "XGigabitEthernet0/1/1", "접속 업링크", 10),
    L("UP-AS-5", "BB-EDGE", "xe-0/0/11", "AS-5", "XGigabitEthernet0/1/1", "접속 업링크", 10)
  ];

  // 심어 둔 포트 이상 (가상)
  const faults = {
    "BB-EDGE|xe-0/0/3": { crc: 1423, rx: -14.2 },            // 해외 연동: CRC 오류 많고 광 수신이 약함
    "BB-B2|Te1/0/1": { crc: 87, rx: -12.9 },                 // 센터B 백본2 (Cisco)
    "BB-OUR|xe-0/0/3": { crc: 0, rx: -12.9 },                // 같은 연결의 반대쪽 끝
    "AS-2|XGigabitEthernet0/1/1": { crc: 12, rx: -9.8 },     // 소규모 접속 스위치 업링크
    "BB-OUR|xe-0/0/17": { crc: 0, rx: -9.8 }
  };

  return { devices, links, faults };
});
