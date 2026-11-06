/* 설계도 (가상): 어떤 장비가 있고 어떻게 연결되는지. 제가 만든 초안이며 모든 이름은 가상입니다.
   이 파일이 센터·장비·연결·고객사의 기준입니다. 관제(그래프 회선), 서버실(랙), 터미널(장비)과 설계도 표가 모두 여기에 맞춰 보입니다.
   이름 규칙: IDC_<센터 코드>_<종류><번호>
     센터 코드: B 분당, S 서초, G 구로, A 안산
     종류: FS = Juniper 계열, FR = Cisco 계열, AS = Huawei 계열 (FS·FR·AS가 무슨 약자인지는 모름)
   랙 이름: IDC_<센터 코드>_R<번호>. 랙에는 네트워크 장비만 들어간다 (서버는 다루지 않음).
   랙 규칙: Cisco 대형 장비는 랙 하나를 혼자 쓴다 (랙당 1대). Juniper는 랙당 최대 2대. Huawei는 소형이라 랙당 최대 8대(제가 정한 가정).
   센터별 장비 수(사용자가 정한 값): 분당 FR4·FS8·AS10, 서초 FR6·FS12·AS30, 구로 FR2·FS4·AS20, 안산 FR4·FS10·AS10.
   구조: 서초에 대형 중앙 백본 2대(IDC_S_FS1, IDC_S_FS2)가 있고, 센터 4곳이 거기에 이중화로 붙는다.
   서초가 장비가 가장 많다. 고객사 13곳은 센터마다 '고객 접속 장비'(Juniper)에 나뉘어 붙는다.
   - centers: 센터 코드와 이름
   - customers: 고객사 (전부 가상). links = 이 고객사가 쓰는 그래프 회선, 접속 장비는 devices의 customers에 적혀 있다
   - devices: 장비 (vendor: juniper / cisco / huawei, rack: 들어 있는 랙, tier: core면 중앙 백본, customers: 이 장비에 붙은 고객사)
   - links: 연결 (a장비 a포트 <-> b장비 b포트). b가 장비 목록에 없으면 외부(IX·해외 등). link는 그래프의 회선 이름.
            회선이 어느 센터 소속인지는 이름의 센터 코드(= a장비가 있는 센터)로 정한다.
   - faults: 포트에 심어 둔 이상 ("장비|포트": crc 오류 수, rx 광 수신값 dBm, down = 연결 끊김(Link down), admin = "down"이면 관리자가 내림). 고객사·회선 배정은 제가 임의로 정한 것입니다. */
(function (root, factory) {
  const t = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = t; else root.TOPOLOGY = t;
})(typeof self !== "undefined" ? self : this, function () {
  const centers = { B: "분당 센터", S: "서초 센터", G: "구로 센터", A: "안산 센터" };
  const B = centers.B, S = centers.S, G = centers.G, A = centers.A;
  const customers = [   // 전부 가상 고객사. 회선은 제가 임의로 나눈 것
    { name: "가상물산", key: "gasang", links: ["IDC_B_FS1_UP1", "IDC_B_FS1_UP2"] },
    { name: "예시미디어", key: "yesi-media", links: ["IDC_B_FS1_UP1", "IDC_A_FS1_UP1", "IDC_B_FS2_IX1"] },
    { name: "샘플게임즈", key: "sample-games", links: ["IDC_G_FS1_UP1", "IDC_S_FR1_UP1"] },
    { name: "테스트클라우드", key: "test-cloud", links: ["IDC_S_FR1_UP1"] },
    { name: "데모스트리밍", key: "demo-streaming", links: ["IDC_B_FS2_IX1", "IDC_B_FS2_INTL1"] },
    { name: "모의커머스", key: "mock-commerce", links: ["IDC_B_FS1_UP2", "IDC_A_FR1_UP1"] },
    { name: "가상은행", key: "gasang-bank", links: ["IDC_B_FS1_UP1", "IDC_B_FS1_UP2"] },
    { name: "예제교육", key: "yeje-edu", links: ["IDC_G_FS1_UP1"] },
    { name: "샘플방송", key: "sample-broadcast", links: ["IDC_B_FS2_IX1", "IDC_A_FS1_UP1"] },
    { name: "시험물류", key: "test-logistics", links: ["IDC_A_FR1_UP1"] },
    { name: "데모헬스", key: "demo-health", links: ["IDC_S_FR1_UP1", "IDC_G_FS1_UP1"] },
    { name: "가상모빌리티", key: "gasang-mobility", links: ["IDC_A_FS1_UP1", "IDC_A_FR1_UP1"] },
    { name: "예시금융", key: "yesi-finance", links: ["IDC_B_FS2_INTL1"] }
  ];
  // 센터별 장비 수 (사용자가 정한 값): FR = Cisco, FS = Juniper, AS = Huawei
  const COUNTS = { B: { FR: 4, FS: 8, AS: 10 }, S: { FR: 6, FS: 12, AS: 30 }, G: { FR: 2, FS: 4, AS: 20 }, A: { FR: 4, FS: 10, AS: 10 } };
  // 랙 규칙: Cisco 대형은 랙당 1대, Juniper는 랙당 최대 2대 (사용자가 알려 준 값). Huawei는 소형이라 랙당 최대 8대 (제가 정한 가정)
  const PER_RACK = { FR: 1, FS: 2, AS: 8 };
  const VENDOR = { FR: "cisco", FS: "juniper", AS: "huawei" };
  // 역할이 정해진 장비. 나머지는 종류별 기본 역할을 붙인다.
  const ROLE = {
    IDC_B_FS1: "분당 센터 백본", IDC_B_FS2: "분당 연동 장비 (IX·해외·CDN)", IDC_B_FS3: "분당 CDN 연결 장비",
    IDC_B_FS4: "분당 고객 접속 1 (가상물산·가상은행)", IDC_B_FS5: "분당 고객 접속 2 (예시미디어·샘플방송)",
    IDC_B_FS6: "분당 고객 접속 3 (데모스트리밍·예시금융)", IDC_B_FS7: "분당 고객 접속 4 (모의커머스)",
    IDC_B_FR1: "분당 센터 백본 (Cisco) 1", IDC_B_FR2: "분당 센터 백본 (Cisco) 2",
    IDC_S_FS1: "서초 중앙 백본 1 (대형)", IDC_S_FS2: "서초 중앙 백본 2 (대형)", IDC_S_FR1: "서초 센터 백본 (Cisco)",
    IDC_S_FS3: "서초 고객 접속 1 (테스트클라우드)", IDC_S_FS4: "서초 고객 접속 2 (데모헬스)",
    IDC_G_FS1: "구로 센터 백본", IDC_G_FS2: "구로 고객 접속 1 (샘플게임즈)", IDC_G_FS3: "구로 고객 접속 2 (예제교육)",
    IDC_A_FS1: "안산 센터 백본", IDC_A_FS2: "안산 고객 접속 (시험물류·가상모빌리티)", IDC_A_FR1: "안산 센터 백본 (Cisco)"
  };
  const EXTRA = {
    IDC_B_FS4: { customers: ["gasang", "gasang-bank"] }, IDC_B_FS5: { customers: ["yesi-media", "sample-broadcast"] },
    IDC_B_FS6: { customers: ["demo-streaming", "yesi-finance"] }, IDC_B_FS7: { customers: ["mock-commerce"] },
    IDC_S_FS1: { tier: "core" }, IDC_S_FS2: { tier: "core" },
    IDC_S_FS3: { customers: ["test-cloud"] }, IDC_S_FS4: { customers: ["demo-health"] },
    IDC_G_FS2: { customers: ["sample-games"] }, IDC_G_FS3: { customers: ["yeje-edu"] },
    IDC_A_FS2: { customers: ["test-logistics", "gasang-mobility"] }
  };
  const DEFAULT_ROLE = { FR: "센터 장비 (Cisco)", FS: "집선 장비 (Juniper)", AS: "랙 접속 스위치 (Huawei)" };
  const devices = [];
  Object.keys(centers).forEach(c => {
    const n = COUNTS[c], nFR = n.FR, nFS = Math.ceil(n.FS / PER_RACK.FS);
    const rackNo = (k, i) => k === "FR" ? i : k === "FS" ? nFR + Math.ceil(i / PER_RACK.FS) : nFR + nFS + Math.ceil(i / PER_RACK.AS);
    ["FR", "FS", "AS"].forEach(k => { for (let i = 1; i <= n[k]; i++) {
      const id = `IDC_${c}_${k}${i}`, rack = `IDC_${c}_R${String(rackNo(k, i)).padStart(2, "0")}`;
      devices.push(Object.assign({ id, vendor: VENDOR[k], role: ROLE[id] || `${centers[c]} ${DEFAULT_ROLE[k]} ${i}`, center: centers[c], rack }, EXTRA[id] || {}));
    } });
  });

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
    // 고객 접속 장비의 업링크: 각 센터 백본에 붙는다
    L("IDC_B_FS1_DN1", "IDC_B_FS1", "xe-0/0/10", "IDC_B_FS4", "xe-0/0/10", "고객 접속 업링크", 10),
    L("IDC_B_FS1_DN2", "IDC_B_FS1", "xe-0/0/11", "IDC_B_FS5", "xe-0/0/10", "고객 접속 업링크", 10),
    L("IDC_B_FS1_DN3", "IDC_B_FS1", "xe-0/0/12", "IDC_B_FS6", "xe-0/0/10", "고객 접속 업링크", 10),
    L("IDC_B_FS1_DN4", "IDC_B_FS1", "xe-0/0/13", "IDC_B_FS7", "xe-0/0/10", "고객 접속 업링크", 10),
    L("IDC_S_FR1_DN1", "IDC_S_FR1", "Te1/0/10", "IDC_S_FS3", "xe-0/0/10", "고객 접속 업링크 (Cisco-Juniper)", 10),
    L("IDC_S_FR1_DN2", "IDC_S_FR1", "Te1/0/11", "IDC_S_FS4", "xe-0/0/10", "고객 접속 업링크 (Cisco-Juniper)", 10),
    L("IDC_G_FS1_DN1", "IDC_G_FS1", "xe-0/0/10", "IDC_G_FS2", "xe-0/0/10", "고객 접속 업링크", 10),
    L("IDC_G_FS1_DN2", "IDC_G_FS1", "xe-0/0/11", "IDC_G_FS3", "xe-0/0/10", "고객 접속 업링크", 10),
    L("IDC_A_FS1_DN1", "IDC_A_FS1", "xe-0/0/10", "IDC_A_FS2", "xe-0/0/10", "고객 접속 업링크", 10)
  ];
  // 나머지 장비는 모두 같은 센터의 백본(허브)에 업링크 한 줄로 붙는다. 허브 포트는 시작 번호부터 차례로 쓴다.
  (function addUplinks() {
    const hub = { B: ["IDC_B_FS1", 14, 5], S: ["IDC_S_FR1", 12, 3], G: ["IDC_G_FS1", 12, 3], A: ["IDC_A_FS1", 11, 2] };   // [허브, 첫 포트 번호, 첫 링크 번호]
    const port = (v, n) => v === "cisco" ? `Te1/${Math.floor(n / 48)}/${n % 48}` : v === "huawei" ? `XGigabitEthernet0/${1 + Math.floor(n / 48)}/${n % 48}` : `xe-0/${Math.floor(n / 48)}/${n % 48}`;
    const linked = new Set(); links.forEach(l => { linked.add(l.a); linked.add(l.b); });
    const by = Object.fromEntries(devices.map(d => [d.id, d]));
    Object.keys(centers).forEach(c => {
      const h = hub[c]; let n = h[1], k = h[2];
      devices.filter(d => d.id.split("_")[1] === c && !linked.has(d.id)).forEach(d => {
        links.push(L(`${h[0]}_DN${k++}`, h[0], port(by[h[0]].vendor, n++), d.id, port(d.vendor, 10), d.vendor === "huawei" ? "랙 업링크" : "장비 업링크", 10));
      });
    });
  })();

  // 심어 둔 포트 이상 (가상)
  const faults = {
    "IDC_B_FS2|xe-0/0/3": { crc: 1423, rx: -14.2 },                 // 해외 연동: CRC 오류 많고 광 수신이 약함
    "IDC_A_FR1|Te1/0/1": { crc: 87, rx: -12.9 },                    // 안산 Cisco 백본
    "IDC_S_FS2|xe-0/0/1": { crc: 0, rx: -12.9 },                    // 같은 연결의 반대쪽 끝 (중앙 백본)
    "IDC_B_FS7|xe-0/0/10": { crc: 12, rx: -9.8 },                   // 고객 접속 4 업링크: 작은 CRC 오류와 약한 광 수신
    "IDC_B_FS1|xe-0/0/13": { crc: 0, rx: -9.8 },
    "IDC_B_FS1|xe-0/0/14": { admin: "down" },                       // 관리자가 일부러 내려 둔 포트 (Admin down)
    "IDC_B_FR3|Te1/0/10": { down: true },                            // 위 포트의 반대쪽 끝: Link down
    "IDC_G_FS1|xe-0/0/11": { down: true },                           // 구로 고객 접속 2 업링크: 연결이 끊김 (Admin up, Link down)
    "IDC_G_FS3|xe-0/0/10": { down: true },
    "IDC_B_AS5|XGigabitEthernet0/1/10": { crc: 12, rx: -9.8 },      // Huawei 접속 스위치 업링크: 작은 CRC 오류와 약한 광 수신
    "IDC_B_FS1|xe-0/0/21": { crc: 0, rx: -9.8 },
    "IDC_B_FS1|xe-0/0/12": { crc: 0, rx: -40 }                      // 과열로 꺼진 IDC_B_FS6 쪽 포트: 빛이 안 들어옴
  };

  return { centers, customers, devices, links, faults };
});
