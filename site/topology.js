/* 설계도 (가상): 어떤 장비가 있고 어떻게 연결되는지. 제가 만든 초안이며 모든 이름은 가상입니다.
   이름 규칙: IDC_<센터 코드>_<종류><번호>
     센터 코드: B 분당, S 서초, G 구로, A 안산
     종류: FS = Juniper 계열, FR = Cisco 계열, AS = Huawei 계열 (FS·FR·AS가 무슨 약자인지는 모름)
   구조: 가장 큰 센터인 서초에 대형 중앙 백본 2대(IDC_S_FS1, IDC_S_FS2)가 있고, 센터 4곳이 거기에 이중화로 붙는다.
   분당은 장비가 많다 (Juniper 6, Cisco 2, Huawei 8). Cisco는 모두 4대. CDN 연결은 여러 곳에 걸쳐 있다.
   터미널의 장비 목록과 포트가 이 표에서 만들어집니다. 고치면 화면에 그대로 반영됩니다.
   - devices: 장비 (vendor: juniper / cisco / huawei, rack: 이 장비가 맡은 랙, tier: core면 중앙 백본)
   - links: 연결 (a장비 a포트 <-> b장비 b포트). b가 장비 목록에 없으면 외부(IX·해외 등). link는 그래프의 회선 이름.
   - faults: 포트에 심어 둔 이상 ("장비|포트": crc 오류 수, rx 광 수신값 dBm). 서버 포트 이상은 app.js에서 따로 둔다. */
(function (root, factory) {
  const t = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = t; else root.TOPOLOGY = t;
})(typeof self !== "undefined" ? self : this, function () {
  const B = "분당 센터", S = "서초 센터", G = "구로 센터", A = "안산 센터";
  const devices = [
    // Juniper (FS): 가장 많이 쓰는 주력 장비
    { id: "IDC_B_FS1", vendor: "juniper", role: "분당 센터 백본", center: B },
    { id: "IDC_B_FS2", vendor: "juniper", role: "분당 연동 장비 (IX·해외·CDN)", center: B },
    { id: "IDC_B_FS3", vendor: "juniper", role: "분당 CDN 연결 장비", center: B },
    { id: "IDC_B_FS4", vendor: "juniper", role: "분당 랙 ToR (A-01)", center: B, rack: "A-01" },
    { id: "IDC_B_FS5", vendor: "juniper", role: "분당 랙 ToR (A-02)", center: B, rack: "A-02" },
    { id: "IDC_B_FS6", vendor: "juniper", role: "분당 랙 ToR (A-03)", center: B, rack: "A-03" },
    { id: "IDC_S_FS1", vendor: "juniper", role: "서초 중앙 백본 1 (대형)", center: S, tier: "core" },
    { id: "IDC_S_FS2", vendor: "juniper", role: "서초 중앙 백본 2 (대형)", center: S, tier: "core" },
    { id: "IDC_A_FS1", vendor: "juniper", role: "안산 센터 백본", center: A },
    { id: "IDC_G_FS1", vendor: "juniper", role: "구로 센터 백본", center: G },
    // Cisco (FR): 비싸서 센터 백본에만 모두 4대
    { id: "IDC_B_FR1", vendor: "cisco", role: "분당 센터 백본 (Cisco) 1", center: B },
    { id: "IDC_B_FR2", vendor: "cisco", role: "분당 센터 백본 (Cisco) 2", center: B },
    { id: "IDC_A_FR1", vendor: "cisco", role: "안산 센터 백본 (Cisco)", center: A },
    { id: "IDC_S_FR1", vendor: "cisco", role: "서초 센터 백본 (Cisco)", center: S },
    // Huawei (AS): 작은 장비가 많다 (B 랙 ToR, 소규모 접속 스위치)
    { id: "IDC_B_AS1", vendor: "huawei", role: "분당 랙 ToR (B-01)", center: B, rack: "B-01" },
    { id: "IDC_B_AS2", vendor: "huawei", role: "분당 랙 ToR (B-02)", center: B, rack: "B-02" },
    { id: "IDC_B_AS3", vendor: "huawei", role: "분당 랙 ToR (B-03)", center: B, rack: "B-03" },
    { id: "IDC_B_AS4", vendor: "huawei", role: "분당 소규모 접속 스위치", center: B },
    { id: "IDC_B_AS5", vendor: "huawei", role: "분당 소규모 접속 스위치", center: B },
    { id: "IDC_B_AS6", vendor: "huawei", role: "분당 소규모 접속 스위치", center: B },
    { id: "IDC_B_AS7", vendor: "huawei", role: "분당 소규모 접속 스위치", center: B },
    { id: "IDC_B_AS8", vendor: "huawei", role: "분당 소규모 접속 스위치", center: B }
  ];

  const L = (link, a, ap, b, bp, kind, gbps) => ({ link, a, ap, b, bp, kind, gbps });
  const links = [
    // 센터 -> 중앙 백본 (그래프에 나오는 회선). 중앙 백본 2대에 나눠 붙어 이중화. Juniper끼리, Juniper-Cisco가 섞여 있다.
    L("IDC_B_FS1_UP1", "IDC_B_FS1", "xe-0/0/0", "IDC_S_FS1", "xe-0/0/0", "분당 → 중앙 백본 (A)", 100),
    L("IDC_B_FS1_UP2", "IDC_B_FS1", "xe-0/0/1", "IDC_S_FS2", "xe-0/0/0", "분당 → 중앙 백본 (B)", 100),
    L("IDC_A_FS1_UP1", "IDC_A_FS1", "xe-0/0/0", "IDC_S_FS1", "xe-0/0/1", "안산 → 중앙 백본 (Juniper-Juniper)", 100),
    L("IDC_A_FR1_UP1", "IDC_A_FR1", "Te1/0/1", "IDC_S_FS2", "xe-0/0/1", "안산 → 중앙 백본 (Cisco-Juniper)", 100),
    L("IDC_G_FS1_UP1", "IDC_G_FS1", "xe-0/0/0", "IDC_S_FS1", "xe-0/0/2", "구로 → 중앙 백본 (Juniper-Juniper)", 200),
    L("IDC_S_FR1_UP1", "IDC_S_FR1", "Te1/0/1", "IDC_S_FS2", "xe-0/0/2", "서초 센터 ↔ 중앙 백본 (Cisco-Juniper)", 400),
    // 중앙 백본끼리
    L("IDC_S_FS1_X1", "IDC_S_FS1", "xe-0/0/10", "IDC_S_FS2", "xe-0/0/10", "중앙 백본 간", 400),
    L("IDC_S_FS1_X2", "IDC_S_FS1", "xe-0/0/11", "IDC_S_FS2", "xe-0/0/11", "중앙 백본 간", 400),
    // 분당 센터 안
    L("IDC_B_FS1_EDGE1", "IDC_B_FS1", "xe-0/0/6", "IDC_B_FS2", "xe-0/0/0", "센터 안 연결", 100),
    L("IDC_B_FS1_EDGE2", "IDC_B_FS1", "xe-0/0/7", "IDC_B_FS2", "xe-0/0/1", "센터 안 연결", 100),
    L("IDC_B_FS1_FR1", "IDC_B_FS1", "xe-0/0/8", "IDC_B_FR1", "Te1/0/1", "센터 안 연결 (Juniper-Cisco)", 100),
    L("IDC_B_FS1_FR2", "IDC_B_FS1", "xe-0/0/9", "IDC_B_FR2", "Te1/0/1", "센터 안 연결 (Juniper-Cisco)", 100),
    // 외부 연결 (상대는 장비 목록에 없음)
    L("IDC_B_FS2_IX1", "IDC_B_FS2", "xe-0/0/2", "국내 IX", "-", "연동(IX)", 100),
    L("IDC_B_FS2_INTL1", "IDC_B_FS2", "xe-0/0/3", "해외 사업자", "-", "해외 연동", 100),
    // CDN 연결은 여러 곳에 걸쳐 있다 (그래프는 없음)
    L("IDC_B_FS2_CDN1", "IDC_B_FS2", "xe-0/0/4", "IDC_B_FS3", "xe-0/0/0", "CDN 연결 (그래프 없음)", 100),
    L("IDC_S_FS1_CDN1", "IDC_S_FS1", "xe-0/0/20", "IDC_B_FS3", "xe-0/0/1", "CDN 연결 (그래프 없음)", 100),
    // 분당 랙 ToR와 소규모 스위치의 업링크
    L("IDC_B_FS1_DN1", "IDC_B_FS1", "xe-0/0/10", "IDC_B_FS4", "xe-0/0/10", "랙 업링크", 10),
    L("IDC_B_FS1_DN2", "IDC_B_FS1", "xe-0/0/11", "IDC_B_FS5", "xe-0/0/10", "랙 업링크", 10),
    L("IDC_B_FS1_DN3", "IDC_B_FS1", "xe-0/0/12", "IDC_B_FS6", "xe-0/0/10", "랙 업링크", 10),
    L("IDC_B_FS1_DN4", "IDC_B_FS1", "xe-0/0/13", "IDC_B_AS1", "XGigabitEthernet0/1/10", "랙 업링크", 10),
    L("IDC_B_FS1_DN5", "IDC_B_FS1", "xe-0/0/14", "IDC_B_AS2", "XGigabitEthernet0/1/10", "랙 업링크", 10),
    L("IDC_B_FS1_DN6", "IDC_B_FS1", "xe-0/0/15", "IDC_B_AS3", "XGigabitEthernet0/1/10", "랙 업링크", 10),
    L("IDC_B_FS1_DN7", "IDC_B_FS1", "xe-0/0/16", "IDC_B_AS4", "XGigabitEthernet0/1/1", "접속 업링크", 10),
    L("IDC_B_FS1_DN8", "IDC_B_FS1", "xe-0/0/17", "IDC_B_AS5", "XGigabitEthernet0/1/1", "접속 업링크", 10),
    L("IDC_B_FS1_DN9", "IDC_B_FS1", "xe-0/0/18", "IDC_B_AS6", "XGigabitEthernet0/1/1", "접속 업링크", 10),
    L("IDC_B_FS2_DN1", "IDC_B_FS2", "xe-0/0/10", "IDC_B_AS7", "XGigabitEthernet0/1/1", "접속 업링크", 10),
    L("IDC_B_FS2_DN2", "IDC_B_FS2", "xe-0/0/11", "IDC_B_AS8", "XGigabitEthernet0/1/1", "접속 업링크", 10)
  ];

  // 심어 둔 포트 이상 (가상)
  const faults = {
    "IDC_B_FS2|xe-0/0/3": { crc: 1423, rx: -14.2 },                 // 해외 연동: CRC 오류 많고 광 수신이 약함
    "IDC_A_FR1|Te1/0/1": { crc: 87, rx: -12.9 },                    // 안산 Cisco 백본
    "IDC_S_FS2|xe-0/0/1": { crc: 0, rx: -12.9 },                    // 같은 연결의 반대쪽 끝 (중앙 백본)
    "IDC_B_AS5|XGigabitEthernet0/1/1": { crc: 12, rx: -9.8 },       // 소규모 접속 스위치 업링크
    "IDC_B_FS1|xe-0/0/17": { crc: 0, rx: -9.8 }
  };

  return { devices, links, faults };
});
