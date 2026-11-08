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
   - 이중화: 모든 장비는 짝 장비가 있다 (FS1-FS2 ...). 짝 장비는 인터커넥트(_PAIR1)로 연결되고, 고객 회선 목록(lines)이 같다.
   - devices.lines: 장비에 꽂힌 고객사 회선 (포트, 속도 1G/10G, 고객사, 홈 장비, state: up = 사용 중, unused = 아직 안 씀(Link down), off = 아직 안 씀(Admin down)). 짝 장비도 같은 회선이 보인다.
   - faults: 포트에 심어 둔 이상 ("장비|포트": crc 오류 수, rx 광 수신값 dBm, down = 연결 끊김(Link down), admin = "down"이면 관리자가 내림). 고객사·회선 배정은 제가 임의로 정한 것입니다. */
(function (root, factory) {
  const t = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = t; else root.TOPOLOGY = t;
})(typeof self !== "undefined" ? self : this, function () {
  const centers = { S: "서초 센터", B: "분당 센터", G: "구로 센터", A: "안산 센터" };   // 서초가 가장 큰 백본 센터라 맨 앞
  const B = centers.B, S = centers.S, G = centers.G, A = centers.A;
  const customers = [   // 전부 가상 고객사. 회선은 제가 임의로 나눈 것
    { name: "가상물산", key: "gasang", links: ["IDC_B_FS1_UP1", "IDC_B_FS1_UP2"] },
    { name: "예시미디어", key: "yesi-media", links: ["IDC_B_FS1_UP1", "IDC_A_FS1_UP1", "IDC_B_FS2_IX1", "IDC_S_FS2_TOB1"] },
    { name: "샘플게임즈", key: "sample-games", links: ["IDC_G_FS1_UP1", "IDC_S_FR1_UP1"] },
    { name: "테스트클라우드", key: "test-cloud", links: ["IDC_S_FR1_UP1"] },
    { name: "데모스트리밍", key: "demo-streaming", links: ["IDC_B_FS2_IX1", "IDC_B_FS2_INTL1", "IDC_S_FS2_TOB1"] },
    { name: "모의커머스", key: "mock-commerce", links: ["IDC_B_FS1_UP2", "IDC_A_FR1_UP1"] },
    { name: "가상은행", key: "gasang-bank", links: ["IDC_B_FS1_UP1", "IDC_B_FS1_UP2"] },
    { name: "예제교육", key: "yeje-edu", links: ["IDC_G_FS1_UP1"] },
    { name: "샘플방송", key: "sample-broadcast", links: ["IDC_B_FS2_IX1", "IDC_A_FS1_UP1", "IDC_S_FS2_TOB1"] },
    { name: "시험물류", key: "test-logistics", links: ["IDC_A_FR1_UP1"] },
    { name: "데모헬스", key: "demo-health", links: ["IDC_S_FR1_UP1", "IDC_G_FS1_UP1"] },
    { name: "가상모빌리티", key: "gasang-mobility", links: ["IDC_A_FS1_UP1", "IDC_A_FR1_UP1"] },
    { name: "예시금융", key: "yesi-finance", links: ["IDC_B_FS2_INTL1"] },
    // 큰 고객사 6곳 (서초 2, 분당 2, 구로 1, 안산 1): 전용 접속 장비와 전용 회선. 이름과 크기는 제가 만든 가정
    { name: "가상스트림", key: "gasang-stream", big: true, links: ["IDC_S_FR1_BIG1"] },
    { name: "시험데이터", key: "sieom-data", big: true, links: ["IDC_S_FR1_BIG2"] },
    { name: "샘플비디오", key: "sample-video", big: true, links: ["IDC_B_FS1_BIG1"] },
    { name: "데모포털", key: "demo-portal", big: true, links: ["IDC_B_FS1_BIG2"] },
    { name: "예제게임월드", key: "yeje-gameworld", big: true, links: ["IDC_G_FS1_BIG1"] },
    { name: "모의OTT", key: "mock-ott", big: true, links: ["IDC_A_FS1_BIG1"] }
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
    IDC_B_FS8: "분당 큰 고객 전용 1 (샘플비디오)", IDC_B_FR4: "분당 큰 고객 전용 2 (데모포털, Cisco)",
    IDC_S_FS5: "서초 큰 고객 전용 1 (가상스트림)", IDC_S_FS6: "서초 큰 고객 전용 2 (시험데이터)",
    IDC_G_FS4: "구로 큰 고객 전용 (예제게임월드)", IDC_A_FS3: "안산 큰 고객 전용 (모의OTT)",
    IDC_A_FS1: "안산 센터 백본", IDC_A_FS2: "안산 고객 접속 (시험물류·가상모빌리티)", IDC_A_FR1: "안산 센터 백본 (Cisco)"
  };
  const EXTRA = {
    IDC_B_FS4: { customers: ["gasang", "gasang-bank"] }, IDC_B_FS5: { customers: ["yesi-media", "sample-broadcast"] },
    IDC_B_FS6: { customers: ["demo-streaming", "yesi-finance"] }, IDC_B_FS7: { customers: ["mock-commerce"] },
    IDC_S_FS1: { tier: "core" }, IDC_S_FS2: { tier: "core" },
    IDC_S_FS3: { customers: ["test-cloud"] }, IDC_S_FS4: { customers: ["demo-health"] },
    IDC_G_FS2: { customers: ["sample-games"] }, IDC_G_FS3: { customers: ["yeje-edu"] },
    IDC_A_FS2: { customers: ["test-logistics", "gasang-mobility"] },
    IDC_B_FS8: { customers: ["sample-video"] }, IDC_B_FR4: { customers: ["demo-portal"] },
    IDC_S_FS5: { customers: ["gasang-stream"] }, IDC_S_FS6: { customers: ["sieom-data"] },
    IDC_G_FS4: { customers: ["yeje-gameworld"] }, IDC_A_FS3: { customers: ["mock-ott"] }
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

  const L = (link, a, ap, b, bp, kind, gbps, feeds) => Object.assign({ link, a, ap, b, bp, kind, gbps }, feeds ? { feeds } : {});   // feeds: 이 회선이 들어가는 센터 (그 센터 관제에서도 보인다)
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
    // 서초 중앙 백본에서 분당으로 들어오는 트래픽 (서초가 소유, 분당 관제에서도 보인다). 용량 200G는 임시값
    L("IDC_S_FS2_TOB1", "IDC_S_FS2", "xe-0/0/21", "IDC_B_FS1", "xe-0/0/2", "서초 → 분당 (서초를 거쳐 들어오는 트래픽)", 200, "B"),
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
    L("IDC_A_FS1_DN1", "IDC_A_FS1", "xe-0/0/10", "IDC_A_FS2", "xe-0/0/10", "고객 접속 업링크", 10),
    // 큰 고객사 전용 회선 (용량은 제가 정한 가정)
    L("IDC_S_FR1_BIG1", "IDC_S_FR1", "Te1/0/2", "IDC_S_FS5", "xe-0/0/10", "큰 고객사 전용 (Cisco-Juniper)", 200),
    L("IDC_S_FR1_BIG2", "IDC_S_FR1", "Te1/0/3", "IDC_S_FS6", "xe-0/0/10", "큰 고객사 전용 (Cisco-Juniper)", 100),
    L("IDC_B_FS1_BIG1", "IDC_B_FS1", "xe-0/0/3", "IDC_B_FS8", "xe-0/0/10", "큰 고객사 전용", 200),
    L("IDC_B_FS1_BIG2", "IDC_B_FS1", "xe-0/0/4", "IDC_B_FR4", "Te1/0/1", "큰 고객사 전용 (Juniper-Cisco)", 100),
    L("IDC_G_FS1_BIG1", "IDC_G_FS1", "xe-0/0/5", "IDC_G_FS4", "xe-0/0/10", "큰 고객사 전용", 100),
    L("IDC_A_FS1_BIG1", "IDC_A_FS1", "xe-0/0/5", "IDC_A_FS3", "xe-0/0/10", "큰 고객사 전용", 100)
  ];
  // ---- 이중화: 같은 종류 장비를 번호 순서대로 둘씩 짝짓는다 (FS1-FS2, FS3-FS4 ... FR1-FR2 ... AS1-AS2 ...)
  const partnerOf = id => { const m = id.match(/^(IDC_[BSGA]_(?:FS|FR|AS))(\d+)$/), n = +m[2]; return `${m[1]}${n % 2 ? n + 1 : n - 1}`; };
  const BY = Object.fromEntries(devices.map(d => [d.id, d]));
  devices.forEach(d => { d.partner = partnerOf(d.id); });
  const PORT = (v, slot, n) => v === "cisco" ? `Te${slot}/0/${n}` : v === "huawei" ? `XGigabitEthernet0/${slot}/${n}` : `xe-${slot}/0/${n}`;
  const portAt = (v, n) => v === "cisco" ? `Te1/${Math.floor(n / 48)}/${n % 48}` : v === "huawei" ? `XGigabitEthernet0/${1 + Math.floor(n / 48)}/${n % 48}` : `xe-0/${Math.floor(n / 48)}/${n % 48}`;
  // 나머지 장비는 같은 센터의 백본(허브)에 업링크 한 줄로 붙고, 허브의 짝 장비에도 한 줄 더 붙는다. 허브 포트는 시작 번호부터 차례로 쓴다.
  (function addUplinks() {
    const hub = { B: ["IDC_B_FS1", 14, 5], S: ["IDC_S_FR1", 12, 3], G: ["IDC_G_FS1", 12, 3], A: ["IDC_A_FS1", 11, 2] };   // [허브, 첫 포트 번호, 첫 링크 번호]
    const linked = new Set(); links.forEach(l => { linked.add(l.a); linked.add(l.b); });
    const firstPass = links.slice();
    Object.keys(centers).forEach(c => {
      const h = hub[c]; let n = h[1], k = h[2];
      devices.filter(d => d.id.split("_")[1] === c && !linked.has(d.id)).forEach(d => {
        links.push(L(`${h[0]}_DN${k++}`, h[0], portAt(BY[h[0]].vendor, n++), d.id, portAt(d.vendor, 10), d.vendor === "huawei" ? "랙 업링크" : "장비 업링크", 10));
      });
      // 허브 연결이 없는 장비(중앙 백본, CDN 장비 등)도 허브에 연결 (기존 포트 번호는 밀리지 않게 마지막에 이어 붙인다)
      const h2x = partnerOf(h[0]);
      devices.filter(d => d.id.split("_")[1] === c && d.id !== h[0] && d.id !== h2x && !links.some(l => (l.a === h[0] && l.b === d.id) || (l.b === h[0] && l.a === d.id))).forEach(d => {
        links.push(L(`${h[0]}_DN${k++}`, h[0], portAt(BY[h[0]].vendor, n++), d.id, portAt(d.vendor, 9), "장비 업링크", 10));
      });
    });
    // 이중화 업링크: 허브의 짝 장비에도 모든 장비가 한 줄씩 더 붙는다
    Object.keys(centers).forEach(c => {
      const h1 = hub[c][0], h2 = partnerOf(h1); let n = 20, k = 1;
      devices.filter(d => d.id.split("_")[1] === c && d.id !== h1 && d.id !== h2).forEach(d => {
        links.push(L(`${h2}_UP${k++}`, h2, portAt(BY[h2].vendor, n++), d.id, portAt(d.vendor, 12), "이중화 업링크 (허브 짝 장비)", 10));
      });
    });
    // 짝 장비끼리 서로 연결 (인터커넥트)
    devices.filter(d => +d.id.match(/(\d+)$/)[1] % 2 === 1).forEach(d => {
      const p = BY[d.partner], slot = d.vendor === "cisco" ? 3 : d.vendor === "huawei" ? 4 : 2;
      links.push(L(`${d.id}_PAIR1`, d.id, PORT(d.vendor, slot, 0), p.id, PORT(p.vendor, slot, 0), "이중화 짝 장비 연결", d.vendor === "cisco" ? 100 : d.vendor === "juniper" ? 40 : 10));
    });
  })();

  // ---- 고객 회선: 장비마다 고객사 회선(1G·10G)이 한 줄씩 꽂혀 있다. 짝 장비는 같은 목록을 가진다 (제가 만든 가상 값).
  const hashS = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const custByCenter = {}; customers.forEach(c => { const k = c.links[0].split("_")[1]; (custByCenter[k] = custByCenter[k] || []).push(c); });
  const linePort = (v, speed, n) => v === "cisco" ? (speed === 10 ? `Te2/0/${n}` : `Gi2/1/${n}`) : v === "huawei" ? (speed === 10 ? `XGigabitEthernet0/2/${n}` : `GigabitEthernet0/3/${n}`.replace(/\/\d+$/, `/${n}`)) : (speed === 10 ? `xe-1/0/${n}` : `ge-1/1/${n}`);
  devices.filter(d => +d.id.match(/(\d+)$/)[1] % 2 === 1).forEach(d => {   // 짝의 첫째 장비(홀수)가 '홈'
    const p = BY[d.partner], h = hashS(d.id), c = d.id.split("_")[1];
    const own = [...(d.customers || []), ...(p.customers || [])];
    const pool = own.length ? own.map(k => customers.find(x => x.key === k)) : custByCenter[c];
    const big = pool.length && pool.every(x => x.big);
    const n = big ? 12 : d.vendor === "cisco" ? 24 + h % 17 : d.vendor === "juniper" ? 10 + h % 13 : 12 + h % 9;
    const run = 1 + h % 3, lines = []; let n10 = 0, n1 = 0;
    for (let k = 0; k < n; k++) {
      const cu = pool[Math.floor(k / run) % pool.length], speed = !big && (h >> (k % 24)) % 5 === 0 ? 1 : 10;
      const r = hashS(d.id + ":" + k) % 100, cut = big ? 85 : 68;   // 아직 쓰지 않는 회선: 일부는 Link down(선만 꽂아 둠), 일부는 Admin down(관리자가 내려 둠)
      const state = k < 2 || r < cut ? "up" : r < cut + (100 - cut) * 0.65 ? "unused" : "off";   // 첫 두 줄은 항상 사용 중
      lines.push({ port: linePort(d.vendor, speed, speed === 10 ? n10++ : n1++), speed, customer: cu.key, home: d.id, state });
    }
    d.lines = lines;
    const pl = lines.map(x => Object.assign({}, x, { port: linePort(p.vendor, x.speed, 0) }));   // 상태(state)도 그대로 복사   // 짝 장비의 포트 이름은 종류에 맞게 다시 붙인다
    let m10 = 0, m1 = 0; pl.forEach(x => { x.port = linePort(p.vendor, x.speed, x.speed === 10 ? m10++ : m1++); });
    p.lines = pl;
  });

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
    "IDC_B_FS1|xe-0/0/21": { crc: 0, rx: -9.8 }
  };

  return { centers, customers, devices, links, faults };
});
