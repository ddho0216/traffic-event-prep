/* 연습 모드: 장비 명령어 사전 + 기록이 남지 않는 연습용 터미널.
   - 여기서 친 명령은 어디에도 저장하지 않는다 (localStorage·서버 없음, 새로고침하면 사라짐). 접속 계정 이름도 쓰지 않는다 (프롬프트는 "연습").
   - 출력은 전부 가상이고, 실제 장비의 출력과 형식·숫자가 다를 수 있다 (제가 아는 형식을 흉내 낸 것).
   - 기존 터미널이 지원하는 명령(DEV_CMDS)은 그대로 재사용하고, 그 밖의 명령은 이 파일의 생성기로 출력한다.
   - 위험한 명령(로그 지우기·재부팅·카운터 지우기)은 실제로 아무 일도 일어나지 않고, 실제 장비라면 어떻게 되는지만 알려 준다. */
(function initPractice() {
  const pane = document.getElementById("practicePane");
  if (!pane) return;
  const S = { vendor: "juniper", dev: null, hist: [], hp: 0, cfg: {} };   // 이 세션 안에서만 쓰는 상태 (저장하지 않음). cfg: 장비별 설정 모드·정적 경로·커밋 전 변경
  const isIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split(".").every(x => +x <= 255), isPrefix = s => /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(s) && isIp(s.split("/")[0]) && +s.split("/")[1] <= 32;
  const cfgOf = d => S.cfg[d.id] || (S.cfg[d.id] = (() => { const nh = sortedIfs(d).filter(f => f[8]).map(f => f[8]); return { mode: false, pending: [], routes: [{ p: "0.0.0.0/0", nh: nh[0] || "10.100.0.1" }, { p: "100.0.0.0/24", nh: nh[1] || nh[0] || "10.100.0.1" }] }; })());
  const custIdx = f => f[10] ? Math.max(0, CUSTOMERS.findIndex(c => c.name === f[10].customer)) : -1;   // 고객 회선은 고객사마다 VLAN 번호를 하나씩 쓴다 (100 + 고객사 순번, 제가 정한 가정)
  const vlansOf = d => { const m = new Map(); sortedIfs(d).forEach(f => { const i = custIdx(f); if (i < 0) return; const id = 100 + i; if (!m.has(id)) m.set(id, { id, cust: f[10].customer, ports: [] }); m.get(id).ports.push(f); }); return [...m.values()].sort((a, b) => a.id - b.id); };
  const vlanOf = f => custIdx(f) >= 0 ? 100 + custIdx(f) : 0;
  const ethName = n => n.replace(/^Te(\d+)\/0\/(\d+)$/, "Ethernet$1/$2");
  const pad = (s, n) => String(s).padEnd(n);
  const nowStr = () => ymdhm(termMs());
  const rackTemp = d => { const r = RACKS.find(x => x.id === d.rack); return r && r.temp ? r.temp[Math.min(r.temp.length - 1, Math.max(0, clamp(NOW_IDX, 0, N - 1)))] : 22; };
  const peers = d => sortedIfs(d).filter(f => DEV[f[1]]);   // 옆 장비와 이어진 포트
  const ifLines = (d, fn) => sortedIfs(d).map(fn).join("\n");
  const SERIAL = d => "TEP" + [...d.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 99991, 7).toString().padStart(5, "0") + "X";   // 가상 일련번호

  /* ---------- 생성기: 가상 출력 ---------- */
  const OUT = {
    jVersion: d => `Hostname: ${d.id}\nModel: (가상) ${d.role}\nJunos: 21.4R3-S2.3 (가상 버전 표기)\nJUNOS Base OS boot [21.4R3-S2.3]`,
    jUptime: d => `Current time: ${nowStr()}:07 KST\nSystem booted: 2026-08-14 02:11:40 KST (68 days ago)\nProtocols started: 2026-08-14 02:13:05 KST (68 days ago)\nLast configured: 2026-10-12 10:42:18 KST by (가상 계정)\n 9:00PM  up 68 days, 18:49, 1 user, load averages: 0.21, 0.18, 0.15`,
    jAlarms: d => { const t = rackTemp(d); return t >= TEMP_WARN ? `1 alarms currently active\nAlarm time               Class  Description\n${nowStr()}:00 KST  Minor  Rack inlet temperature high (${t.toFixed(1)}°C)` : "No alarms currently active"; },
    jEnv: d => { const t = rackTemp(d); return `Class Item                           Status     Measurement\nTemp  Routing Engine                 OK         ${Math.round(t + 17)} degrees C / ${Math.round((t + 17) * 1.8 + 32)} degrees F\nTemp  FPC 0 Intake                   OK         ${t.toFixed(0)} degrees C / ${Math.round(t * 1.8 + 32)} degrees F\nFans  Fan Tray 0 Fan 1               OK         Spinning at normal speed\nFans  Fan Tray 0 Fan 2               OK         Spinning at normal speed\nPower PSU 0                          OK\nPower PSU 1                          OK`; },
    jHardware: d => `Hardware inventory:\nItem             Version  Part number  Serial number     Description\nChassis                                ${SERIAL(d)}  (가상) ${d.role}\nRouting Engine 0                       ${SERIAL(d)}  RE\nFPC 0            REV 01   (가상)       ${SERIAL(d)}  FPC\nPower Supply 0   REV 01   (가상)       ${SERIAL(d)}  AC Power Supply\nPower Supply 1   REV 01   (가상)       ${SERIAL(d)}  AC Power Supply\nFan Tray 0                             (가상)        Fan Tray`,
    jTerse: d => "Interface               Admin Link Proto    Local                 Remote\n" + ifLines(d, f => `${pad(f[0], 23)} ${pad(f[6], 5)} ${pad(f[5], 4)} ${f[7] ? "inet     " + pad(f[7] + "/30", 21) : ""}`.trimEnd()),
    jLldp: d => "Local Interface    Parent Interface    Chassis Id          Port info          System Name\n" + (peers(d).map(f => `${pad(f[0], 18)} ${pad("-", 19)} ${pad("00:11:22:" + SERIAL(DEV[f[1]]).slice(3, 5) + ":aa:bb", 19)} ${pad(f[4] ? (f[4].a === d.id ? f[4].bp : f[4].ap) : "-", 18)} ${f[1]}`).join("\n") || "(이웃 없음)"),
    jRouteSum: d => `Autonomous system number: ${64500 + (d.id.length % 20)}\nRouter ID: 10.255.${d.id.length}.1\n\ninet.0: ${40 + sortedIfs(d).length * 3} destinations, ${44 + sortedIfs(d).length * 3} routes (${40 + sortedIfs(d).length * 3} active, 0 holddown, 0 hidden)\n              Direct:     ${sortedIfs(d).filter(f => f[7]).length} routes,     ${sortedIfs(d).filter(f => f[7]).length} active\n               Local:     ${sortedIfs(d).filter(f => f[7]).length} routes,     ${sortedIfs(d).filter(f => f[7]).length} active\n                 BGP:     ${30 + sortedIfs(d).length} routes,     ${30 + sortedIfs(d).length} active`,
    jStorage: d => "Filesystem              Size       Used      Avail  Capacity   Mounted on\n/dev/gpt/junos          2.6G       1.1G       1.3G       46%   /\ndevfs                   1.0K       1.0K         0B      100%   /dev\n/dev/md0                 1.2G       1.2G         0B     100%   /packages/mnt/os-runtime\n/dev/gpt/var             8.4G       1.6G       6.1G       21%   /var",
    jRe: d => `Routing Engine status:\n  Temperature                 ${Math.round(rackTemp(d) + 17)} degrees C\n  CPU temperature             ${Math.round(rackTemp(d) + 19)} degrees C\n  DRAM                      4096 MB (4096 MB installed)\n  Memory utilization          38 percent\n  CPU utilization:\n    User                       3 percent\n    Idle                      95 percent\n  Model                          RE (가상)\n  Start time                     2026-08-14 02:11:40 KST\n  Uptime                         68 days, 18 hours, 49 minutes\n  Last reboot reason             Normal shutdown`,
    jUsers: d => "USER     TTY      FROM                              LOGIN@  IDLE WHAT\n(연습)   p0       (연습 모드는 접속 기록이 없음)    9:00PM     - -cli (cli)",
    jCliHist: () => practiceHistory(),
    cVersion: d => `Cisco Nexus Operating System (NX-OS) Software (가상 표기)\n  system:    version 9.3(8) (가상)\n  Device name: ${d.id}\n  Hardware: (가상) ${d.role}\n  bootflash: 3 GB (가상)\nKernel uptime is 68 day(s), 18 hour(s), 49 minute(s), 12 second(s)`,
    cInventory: d => `NAME: "Chassis", DESCR: "(가상) ${d.role}"\nPID: (가상), VID: V01, SN: ${SERIAL(d)}\n\nNAME: "Slot 1", DESCR: "(가상) 10G I/O 모듈"\nPID: (가상), VID: V01, SN: ${SERIAL(d)}`,
    cEnv: d => `Fan:\n---------------------------------------------------\nFan             Model                Hw     Status\n---------------------------------------------------\nFan1(sys_fan1)  (가상)               --     Ok\nFan2(sys_fan2)  (가상)               --     Ok\n\nTemperature:\n--------------------------------------------------------------------\nModule   Sensor        MajorThresh   MinorThres   CurTemp     Status\n                       (Celsius)     (Celsius)    (Celsius)\n--------------------------------------------------------------------\n1        Intake        70            42           ${rackTemp(d).toFixed(0)}          Ok\n1        Exhaust       75            50           ${Math.round(rackTemp(d) + 10)}          Ok\n\nPower Supply:\nPS  Model                Power(W)   Status\n1   (가상)               650        Ok\n2   (가상)               650        Ok`,
    cModule: d => `Mod Ports             Module-Type                      Model              Status\n--- ----- -------------------------------- ------------------ ------------\n1   ${sortedIfs(d).length}    (가상) 10G I/O 모듈              (가상)             ok\n\nMod  Sw              Hw      Slot\n---  --------------  ------  ----\n1    9.3(8)          1.0     1`,
    cIfStatus: d => "--------------------------------------------------------------------------------\nPort          Name               Status    Vlan      Duplex  Speed   Type\n--------------------------------------------------------------------------------\n" + ifLines(d, f => `${pad(f[0], 13)} ${pad((f[1] || "").slice(0, 18), 18)} ${pad(f[5] === "up" ? "connected" : f[6] === "down" ? "disabled" : "notconnect", 9)} routed    full    10G     10Gbase-LR`),
    cIpBrief: d => `IP Interface Status for VRF "default"(1)\nInterface            IP Address      Interface Status\n` + ifLines(d, f => `${pad(f[0], 20)} ${pad(f[7] || "unassigned", 15)} protocol-${f[5] === "up" ? "up" : "down"}/link-${f[5] === "up" ? "up" : "down"}/admin-${f[6]}`) + vlansOf(d).map(v => `\n${pad("Vlan" + v.id, 20)} ${pad("10." + (200 + (v.id - 100) % 50) + ".0.1", 15)} protocol-up/link-up/admin-up`).join(""),
    cRouteSum: d => `IP Route Table for VRF "default"\nRoute Source           Networks\nconnected              ${sortedIfs(d).filter(f => f[7]).length}\nbgp-64500              ${30 + sortedIfs(d).length}\nTotal                  ${30 + sortedIfs(d).length * 2}`,
    cCdp: d => "Capability Codes: R - Router, S - Switch\nDevice-ID          Local Intrfce  Hldtme Capability  Platform      Port ID\n" + (peers(d).map(f => `${pad(f[1], 18)} ${pad(f[0], 14)} 150    R S        (가상)        ${f[4] ? (f[4].a === d.id ? f[4].bp : f[4].ap) : "-"}`).join("\n") || "(이웃 없음)"),
    cClock: () => `${nowStr()}:09.812 KST (가상 시각)`,
    cUsers: () => "NAME     LINE         TIME         IDLE          PID COMMENT\n(연습)   pts/0        Oct 22 21:00 .           (연습 모드는 접속 기록이 없음) *",
    cCpu: d => `CPU utilization for five seconds: 3%/1%; one minute: 2%; five minutes: 2%\nPID    Runtime(ms)  Invoked   uSecs  1Sec    Process\n-----  -----------  --------  -----  ------  -----------\n1      812          91233     8      0.00%   init\n2210   5120         11230     456    0.20%   bgp`,
    cErrCounters: d => "--------------------------------------------------------------------------------\nPort          Align-Err    FCS-Err   Xmit-Err    Rcv-Err  UnderSize OutDiscards\n--------------------------------------------------------------------------------\n" + ifLines(d, f => `${pad(f[0], 13)} ${pad(0, 12)} ${pad(f[2], 9)} ${pad(0, 11)} ${pad(f[2], 8)} ${pad(0, 10)} 0`),
    hVersion: d => `Huawei Versatile Routing Platform Software (가상 표기)\nVRP (R) software, Version 5.170 (가상)\nHUAWEI (가상) uptime is 68 days, 18 hours, 49 minutes\nBKP 0 version information:\n  Device: ${d.id}`,
    hDevice: d => `${d.id}'s Device status:\nSlot Sub Type                 Online    Power    Register     Status   Role\n-------------------------------------------------------------------------------\n0    -   (가상) ${d.role.slice(0, 14)}   Present   PowerOn  Registered   Normal   Master\n\nFan status: normal   Power status: normal`,
    hIfBrief: d => "PHY: Physical\n*down: administratively down\nInterface                   PHY     Protocol  InUti OutUti   inErrors  outErrors\n" + ifLines(d, f => `${pad(f[0].replace("XGigabitEthernet", "XGE"), 27)} ${pad(f[6] === "down" ? "*down" : f[5], 7)} ${pad(f[5], 9)} 0%    0%   ${pad(f[2], 10)} 0`),
    hLldp: d => "Local Intf       Neighbor Dev             Neighbor Intf             Exptime(s)\n" + (peers(d).map(f => `${pad(f[0].replace("XGigabitEthernet", "XGE"), 16)} ${pad(f[1], 24)} ${pad(f[4] ? (f[4].a === d.id ? f[4].bp : f[4].ap) : "-", 25)} 112`).join("\n") || "(이웃 없음)"),
    hCpu: d => `CPU utilization statistics at ${nowStr()}\nSystem CPU Using Percentage : 4%\nCPU utilization for five seconds: 4%: one minute: 3%: five minutes: 3%.`,
    hMem: d => "System Total Memory Is: 536870912 bytes\nTotal Memory Used Is: 214748364 bytes\nMemory Using Percentage Is: 40%",
    hAlarm: d => { const t = rackTemp(d); return t >= TEMP_WARN ? `------------------------------------------------------------------------------\nSequence  AlarmId  Level  Date Time            Description\n1         0x1000   Minor  ${nowStr()}   Inlet temperature high (${t.toFixed(1)}C)` : "Info: No alarm active."; },
    hUsers: () => "  User-Intf    Delay    Type   Network Address     AuthenStatus   AuthorcmdFlag\n+ 0   CON 0    00:00:00 (연습)                      pass           no\n(연습 모드는 접속 기록이 없음)",
    hClock: () => `${nowStr()}:11+09:00 (가상 시각)`
  };
  function practiceHistory() { return S.hist.length ? S.hist.map((c, i) => { const s = (21 * 3600 + i * 23) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")} ${c}`; }).join("\n") + "\n[연습] 이 연습 화면에서 친 명령만 보이고, 저장되지 않아 새로고침하면 사라집니다." : "(아직 친 명령이 없습니다)"; }

  /* ---------- 명령어 사전 ---------- */
  // v: 제조사, cat: 분류, cmd: 입력 예시({port}·{ip}는 고른 장비에 맞게 채움), what: 한 줄 설명, read: 결과 읽는 법, own: 이 파일의 생성기 이름(없으면 기존 터미널이 처리), risk: 위험 명령 설명
  const LIB = [
    { v: "juniper", cat: "장비 상태", cmd: "show version", what: "장비 모델·OS 버전 확인", read: "Junos 버전이 같은 계열 장비와 같은지 봅니다. 업그레이드 작업 뒤에 확인합니다.", own: "jVersion" },
    { v: "juniper", cat: "장비 상태", cmd: "show system uptime", what: "켜진 지 얼마나 됐는지", read: "최근에 재부팅했다면 uptime이 짧습니다. 장애 시각과 맞는지 봅니다.", own: "jUptime" },
    { v: "juniper", cat: "장비 상태", cmd: "show chassis alarms", what: "장비 경보(온도·팬·전원) 확인", read: "\"No alarms currently active\"가 정상입니다. 경보가 있으면 Class(Minor/Major)와 설명을 봅니다.", own: "jAlarms" },
    { v: "juniper", cat: "장비 상태", cmd: "show system alarms", what: "시스템 경보 확인", read: "chassis alarms와 함께 봅니다. 설정·라이선스 경고가 나옵니다.", own: "jAlarms" },
    { v: "juniper", cat: "장비 상태", cmd: "show chassis environment", what: "온도·팬·전원 상태", read: "Status가 모두 OK이고 온도가 평소와 비슷하면 정상입니다. 입구 온도가 오르면 냉각 문제를 의심합니다.", own: "jEnv" },
    { v: "juniper", cat: "장비 상태", cmd: "show chassis hardware", what: "장비 부품·일련번호 목록", read: "교체나 RMA(반품) 요청 때 일련번호를 확인합니다.", own: "jHardware" },
    { v: "juniper", cat: "장비 상태", cmd: "show chassis routing-engine", what: "CPU·메모리 사용률", read: "Idle이 낮고 CPU 사용률이 높으면 과부하를 의심합니다.", own: "jRe" },
    { v: "juniper", cat: "장비 상태", cmd: "show system storage", what: "디스크 사용량", read: "Capacity가 100%에 가까운 곳이 있는지 봅니다 (/var이 차면 로그 문제).", own: "jStorage" },
    { v: "juniper", cat: "회선·인터페이스", cmd: "show interfaces descriptions", what: "전체 포트 상태와 설명", read: "Admin up + Link down이면 끊긴 것, Admin down이면 누가 내린 것입니다." },
    { v: "juniper", cat: "회선·인터페이스", cmd: "show interfaces terse", what: "포트별 Up/Down과 IP를 짧게", read: "Admin/Link 칸이 up/down인지, 어느 포트에 IP가 있는지 한눈에 봅니다.", own: "jTerse" },
    { v: "juniper", cat: "회선·인터페이스", cmd: "show interfaces diagnostics optics {port}", what: "그 포트의 광 수신값", read: "수신값이 평소보다 크게 낮으면(-9 dBm 아래) 케이블·SFP를 의심합니다." },
    { v: "juniper", cat: "회선·인터페이스", cmd: "show interfaces extensive {port} | match CRC", what: "그 포트의 CRC 오류 수", read: "0이 아니고 계속 늘면 케이블·SFP를 의심합니다." },
    { v: "juniper", cat: "이웃·경로", cmd: "show lldp neighbors", what: "옆에 어떤 장비가 붙어 있는지", read: "System Name과 Port info로 어느 장비의 어느 포트에 연결됐는지 알 수 있습니다.", own: "jLldp" },
    { v: "juniper", cat: "이웃·경로", cmd: "show route summary", what: "경로 개수 요약", read: "BGP 경로 수가 평소보다 크게 줄면 연동 장애를 의심합니다.", own: "jRouteSum" },
    { v: "juniper", cat: "이웃·경로", cmd: "show bgp summary", what: "BGP 상대(피어) 상태", read: "숫자(경로 수)가 보이면 정상, Active/Idle이면 끊긴 것입니다." },
    { v: "juniper", cat: "이웃·경로", cmd: "show route {ip}", what: "그 IP가 지나는 회선", read: "via 뒤의 포트가 지나가는 회선입니다." },
    { v: "juniper", cat: "이웃·경로", cmd: "ping {ip} rapid count 100", what: "상대까지 닿는지 100번 확인", read: "느낌표(!)는 응답, 점(.)은 무응답입니다. 손실 0%가 정상입니다." },
    { v: "juniper", cat: "로그·기록", cmd: "show log messages | last 20", what: "최근 로그 20줄", read: "Down 기록의 시각이 장애 시작 시각입니다." },
    { v: "juniper", cat: "로그·기록", cmd: "show cli history", what: "이 접속에서 친 명령 목록", read: "방금 어떤 명령을 쳤는지 되짚을 때 씁니다. 연습 모드에서는 이 연습 화면의 명령만 보입니다.", own: "jCliHist" },
    { v: "juniper", cat: "로그·기록", cmd: "show system users", what: "지금 접속해 있는 사람", read: "누가 접속 중인지, 얼마나 놀고 있는지 봅니다.", own: "jUsers" },
    { v: "juniper", cat: "설정", cmd: "show configuration interfaces {port} | display set", what: "포트 설정 확인", read: "disable이 있으면 관리자가 내려 둔 포트입니다." },
    { v: "juniper", cat: "설정", cmd: "show configuration routing-options static | display set", what: "정적 경로(기본 경로 등) 설정 보기", read: "route 뒤가 목적지, next-hop 뒤가 다음 장비 IP입니다. 0.0.0.0/0은 기본 경로입니다." },
    { v: "juniper", cat: "설정", cmd: "show configuration routing-options static | display set | match 100.0.0.0", what: "정적 경로 중 특정 대역만 찾기", read: "| match 뒤의 글자가 들어 있는 줄만 보여 줍니다. 특정 고객 대역이 어느 장비로 향하는지 찾을 때 씁니다." },
    { v: "cisco", cat: "장비 상태", cmd: "show version", what: "장비 모델·OS 버전과 uptime", read: "최근 재부팅 여부는 Kernel uptime으로 봅니다.", own: "cVersion" },
    { v: "cisco", cat: "장비 상태", cmd: "show inventory", what: "부품·일련번호 목록", read: "교체·RMA 때 일련번호를 확인합니다.", own: "cInventory" },
    { v: "cisco", cat: "장비 상태", cmd: "show environment", what: "온도·팬·전원 상태", read: "Status가 Ok이고 CurTemp가 임계값보다 낮으면 정상입니다.", own: "cEnv" },
    { v: "cisco", cat: "장비 상태", cmd: "show module", what: "라인카드(모듈) 상태", read: "Status가 ok가 아니면 그 모듈의 포트가 영향받습니다.", own: "cModule" },
    { v: "cisco", cat: "장비 상태", cmd: "show processes cpu", what: "CPU 사용률", read: "five seconds 값이 계속 높으면 과부하를 의심합니다.", own: "cCpu" },
    { v: "cisco", cat: "장비 상태", cmd: "show clock", what: "장비 시각", read: "로그 시각과 맞는지 확인할 때 씁니다.", own: "cClock" },
    { v: "cisco", cat: "회선·인터페이스", cmd: "show interfaces description", what: "전체 포트 상태와 설명", read: "Status/Protocol이 up/down인지 봅니다." },
    { v: "cisco", cat: "회선·인터페이스", cmd: "show interface status", what: "포트 상태를 한 줄씩", read: "connected / notconnect / disabled로 구분됩니다.", own: "cIfStatus" },
    { v: "cisco", cat: "회선·인터페이스", cmd: "show ip interface brief", what: "포트별 IP와 상태", read: "IP가 없는 포트는 unassigned로 나옵니다.", own: "cIpBrief" },
    { v: "cisco", cat: "회선·인터페이스", cmd: "show interface counters errors", what: "포트별 에러 카운터", read: "FCS-Err가 0이 아니고 늘면 케이블·SFP를 의심합니다.", own: "cErrCounters" },
    { v: "cisco", cat: "이웃·경로", cmd: "show cdp neighbors", what: "옆에 붙은 장비", read: "Device-ID와 Port ID로 연결 상대를 확인합니다.", own: "cCdp" },
    { v: "cisco", cat: "이웃·경로", cmd: "show ip route summary", what: "경로 개수 요약", read: "bgp 경로 수가 크게 줄면 연동 장애를 의심합니다.", own: "cRouteSum" },
    { v: "cisco", cat: "이웃·경로", cmd: "show bgp summary", what: "BGP 상대 상태", read: "State/PfxRcd가 숫자면 정상, Active/Idle이면 끊긴 것입니다." },
    { v: "cisco", cat: "이웃·경로", cmd: "ping {ip} repeat 100", what: "상대까지 닿는지 100번 확인", read: "!는 응답, .는 무응답입니다." },
    { v: "cisco", cat: "로그·기록", cmd: "show logging last 100", what: "최근 로그 100줄", read: "UPDOWN 기록의 시각이 장애 시작 시각입니다." },
    { v: "cisco", cat: "로그·기록", cmd: "show users", what: "지금 접속해 있는 사람", read: "누가 접속 중인지 봅니다.", own: "cUsers" },
    { v: "cisco", cat: "설정", cmd: "show running-config interface {port}", what: "포트 설정 확인", read: "shutdown이 있으면 관리자가 내려 둔 포트입니다." },
    { v: "cisco", cat: "설정", cmd: "show running-config interface {eport}", what: "포트 설정 확인 (Ethernet 1/17 형식, VLAN 포함)", read: "switchport access vlan 100이면 100번 VLAN에 묶인 고객 포트, no switchport + ip address면 라우팅 포트(장비 간 연결)입니다.", },
    { v: "cisco", cat: "설정", cmd: "show running-config interface {vlan}", what: "VLAN 인터페이스(SVI) 설정 확인", read: "VLAN에 붙은 IP(게이트웨이)와 설명을 봅니다. 그 VLAN 고객의 기본 게이트웨이입니다." },
    { v: "cisco", cat: "설정", cmd: "show vlan brief", what: "VLAN 목록과 어느 포트가 묶였는지", read: "VLAN 번호별로 그 VLAN에 속한 포트(Eth1/17 등)가 나옵니다. 고객 포트가 어느 VLAN인지 찾을 때 씁니다." },
    { v: "huawei", cat: "장비 상태", cmd: "display version", what: "장비 OS 버전과 uptime", read: "uptime이 짧으면 최근에 재부팅한 것입니다.", own: "hVersion" },
    { v: "huawei", cat: "장비 상태", cmd: "display device", what: "장비·카드 상태", read: "Status가 Normal이 아니면 그 카드를 확인합니다.", own: "hDevice" },
    { v: "huawei", cat: "장비 상태", cmd: "display cpu-usage", what: "CPU 사용률", read: "five seconds 값이 계속 높으면 과부하를 의심합니다.", own: "hCpu" },
    { v: "huawei", cat: "장비 상태", cmd: "display memory-usage", what: "메모리 사용률", read: "Using Percentage가 계속 오르면 누수를 의심합니다.", own: "hMem" },
    { v: "huawei", cat: "장비 상태", cmd: "display alarm active", what: "지금 켜져 있는 경보", read: "\"No alarm active\"가 정상입니다.", own: "hAlarm" },
    { v: "huawei", cat: "장비 상태", cmd: "display clock", what: "장비 시각", read: "로그 시각과 맞는지 확인할 때 씁니다.", own: "hClock" },
    { v: "huawei", cat: "회선·인터페이스", cmd: "display interface description", what: "전체 포트 상태와 설명", read: "PHY/Protocol이 up/down인지, *down은 관리자가 내린 것입니다." },
    { v: "huawei", cat: "회선·인터페이스", cmd: "display interface brief", what: "포트 상태와 에러 수", read: "inErrors가 0이 아니면 케이블·SFP를 의심합니다.", own: "hIfBrief" },
    { v: "huawei", cat: "회선·인터페이스", cmd: "display transceiver interface {hwport} verbose", what: "그 포트의 광 수신값", read: "Rx Power가 평소보다 크게 낮으면 케이블·SFP를 의심합니다." },
    { v: "huawei", cat: "이웃·경로", cmd: "display lldp neighbor brief", what: "옆에 붙은 장비", read: "Neighbor Dev와 Neighbor Intf로 연결 상대를 확인합니다.", own: "hLldp" },
    { v: "huawei", cat: "로그·기록", cmd: "display logbuffer", what: "최근 로그", read: "Down 기록의 시각이 장애 시작 시각입니다." },
    { v: "huawei", cat: "로그·기록", cmd: "display users", what: "지금 접속해 있는 사람", read: "누가 접속 중인지 봅니다.", own: "hUsers" },
    { v: "huawei", cat: "설정", cmd: "display current-configuration interface {hwport}", what: "포트 설정 확인 (VLAN 포함)", read: "port default vlan이 있으면 그 VLAN에 묶인 고객 포트(access), trunk allow-pass는 여러 VLAN이 지나가는 연결 포트입니다. shutdown은 관리자가 내려 둔 포트입니다." },
    { v: "huawei", cat: "설정", cmd: "display vlan", what: "VLAN 목록과 어느 포트가 묶였는지", read: "VID별로 속한 포트가 나옵니다 (UT = 태그 없음/access, TG = 태그 있음/trunk)." },
  ];
  /* 위험 명령은 사전에 싣지 않는다 (따라 쳤다가 실제 장비에서 큰일 나지 않도록). 연습 터미널에서 직접 쳤을 때만 아무 일도 안 일어나게 하고 왜 위험한지 알려 준다 */
  const RISK = [
    { v: "juniper", cat: "위험 명령", cmd: "clear log messages", what: "로그 파일 지우기", read: "", risk: "실제 장비라면 로그가 지워져서 장애 원인을 찾을 수 없게 되고, \"로그를 지웠다\"는 사실이 다른 기록에 남을 수 있습니다. 로그는 장애 원인과 작업 증거라서 함부로 지우지 않습니다." },
    { v: "juniper", cat: "위험 명령", cmd: "clear interfaces statistics all", what: "포트 카운터(CRC 등) 0으로 되돌리기", read: "", risk: "CRC·에러 카운터가 0이 되어 장애 증거가 사라집니다. 지우기 전에 값을 캡처·기록해 둬야 합니다." },
    { v: "juniper", cat: "위험 명령", cmd: "request system reboot", what: "장비 재부팅", read: "", risk: "실제 장비라면 \"Reboot the system? [yes,no]\"라고 한 번 묻고, yes면 장비가 꺼져 연결된 고객 회선이 모두 끊깁니다. 짝 장비(이중화)가 받는지, 작업 승인이 있는지 먼저 확인해야 합니다." },
    { v: "cisco", cat: "위험 명령", cmd: "clear logging logfile", what: "로그 파일 지우기", read: "", risk: "실제 장비라면 저장된 로그가 지워져서 장애 원인을 찾기 어려워집니다. 지웠다는 사실도 기록에 남을 수 있습니다." },
    { v: "cisco", cat: "위험 명령", cmd: "clear counters", what: "포트 카운터 0으로 되돌리기", read: "", risk: "CRC·에러 카운터가 사라져 장애 증거가 없어집니다. 먼저 값을 기록해 두세요." },
    { v: "cisco", cat: "위험 명령", cmd: "reload", what: "장비 재부팅", read: "", risk: "실제 장비라면 \"Proceed with reload? (y/n)\"라고 묻고, y면 장비가 꺼져 연결된 회선이 모두 끊깁니다. 이중화 짝과 작업 승인을 먼저 확인합니다." },
    { v: "huawei", cat: "위험 명령", cmd: "reset logbuffer", what: "로그 버퍼 지우기", read: "", risk: "실제 장비라면 \"Are you sure to clear? [Y/N]\"이라고 묻고, Y면 로그가 지워져 장애 원인을 찾기 어려워집니다." },
    { v: "huawei", cat: "위험 명령", cmd: "reset counters interface", what: "포트 카운터 0으로 되돌리기", read: "", risk: "inErrors 같은 카운터가 사라져 장애 증거가 없어집니다. 먼저 값을 기록해 두세요." },
    { v: "huawei", cat: "위험 명령", cmd: "reboot", what: "장비 재부팅", read: "", risk: "실제 장비라면 저장 여부와 재부팅 여부를 묻고, 진행하면 장비가 꺼져 연결된 회선이 모두 끊깁니다. 이중화 짝과 작업 승인을 먼저 확인합니다." }
  ];
  const CATS = ["장비 상태", "회선·인터페이스", "이웃·경로", "로그·기록", "설정"];
  const dev = () => DEV[S.dev] || DEVICES.find(d => d.vendor === S.vendor);
  const fill = (cmd, d) => {   // {port}·{ip}·{hwport}를 고른 장비에 맞게 채운다
    const bad = d.ifs.find(f => !f[11] && (f[2] > 50 || f[3] < -9)) || d.ifs.find(f => !f[11]) || d.ifs[0], pp = d.ifs.find(f => f[8] && f[5] === "up");
    const ev = vlansOf(d)[0], ep = d.ifs.find(f => /^Te\d+\/0\/\d+$/.test(f[0]) && !f[11]);
    return cmd.replace("{eport}", ep ? "ethernet " + ethName(ep[0]).replace("Ethernet", "") : "ethernet 1/1").replace("{vlan}", "vlan" + (ev ? ev.id : 100)).replace("{port}", bad ? bad[0] : "xe-0/0/0").replace("{ip}", pp ? pp[8] : "10.100.0.1").replace("{hwport}", bad ? bad[0].replace("XGigabitEthernet", "XGigabitEthernet ") : "XGigabitEthernet0/0/1");
  };
  const libFor = () => LIB.filter(x => x.v === S.vendor).map(x => Object.assign({}, x, { text: fill(x.cmd, dev()) }));

  /* ---------- 터미널 ---------- */
  const $o = () => document.getElementById("prOut");
  const prompt = d => d.vendor === "juniper" ? `연습@${d.id}${cfgOf(d).mode ? "#" : ">"}` : d.vendor === "cisco" ? `${d.id}#` : `<${d.id}>`;   // 계정 이름 대신 "연습"
  const print = html => { const t = $o(); t.insertAdjacentHTML("beforeend", html); t.scrollTop = t.scrollHeight; };
  const lev = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };
  const suggest = (cmd, lib) => lib.map(x => ({ x, s: lev(cmd.toLowerCase(), x.text.toLowerCase()) })).filter(o => o.s <= Math.max(6, cmd.length * 0.35)).sort((a, b) => a.s - b.s).slice(0, 3).map(o => o.x.text);
  /* 이 연습 모드에서만 하는 설정 흉내: 정적 경로 설정(Juniper), VLAN이 들어간 포트 설정(Cisco·Huawei) */
  const routeText = r => `    route ${r.p} next-hop ${r.nh};`;
  function applyPending(c) { const next = c.routes.map(r => Object.assign({}, r)); c.pending.forEach(o => { if (o.op === "set") { if (!next.some(r => r.p === o.p && r.nh === o.nh)) next.push({ p: o.p, nh: o.nh }); } else for (let i = next.length - 1; i >= 0; i--) if (next[i].p === o.p && (!o.nh || next[i].nh === o.nh)) next.splice(i, 1); }); return next; }
  function junosExtra(cmd, d) {
    const c = cfgOf(d);
    let m;
    if ((m = cmd.match(/^show configuration routing-options static(?: \| display set)?(?: \| match (.+))?$/i))) {
      let lines = c.routes.map(r => `set routing-options static route ${r.p} next-hop ${r.nh}`);
      if (m[1]) { const pat = m[1].trim().replace(/^"|"$/g, ""); let re; try { re = new RegExp(pat); } catch (e) { re = null; } lines = lines.filter(l => re ? re.test(l) : l.includes(pat)); }
      return { text: lines.join("\n") };
    }
    if (/^configure$/i.test(cmd)) { c.mode = true; return { text: "Entering configuration mode" }; }
    if (!c.mode) { if (/^(set|delete|commit|rollback)\b/i.test(cmd)) return { text: "                     ^\nunknown command.\n[연습] 설정을 바꾸는 명령(set·delete·commit)은 \"configure\"로 설정 모드에 들어간 뒤에 씁니다 (프롬프트가 > 에서 # 으로 바뀜).", err: true }; return null; }
    if (/^exit(?: configuration-mode)?$/i.test(cmd) || /^quit$/i.test(cmd)) { const n = c.pending.length; c.mode = false; c.pending = []; return { text: n ? `Exiting configuration mode\n[연습] 커밋하지 않은 변경 ${n}건은 적용되지 않고 사라졌습니다.` : "Exiting configuration mode" }; }
    if ((m = cmd.match(/^set routing-options static route (\S+) next-hop (\S+)$/i))) {
      if (!isPrefix(m[1])) return { text: `error: invalid prefix '${m[1]}' (a.b.c.d/길이 형식으로 쓰세요. 예: 0.0.0.0/0)`, err: true };
      if (!isIp(m[2])) return { text: `error: invalid next-hop '${m[2]}'`, err: true };
      c.pending.push({ op: "set", p: m[1], nh: m[2] }); return { text: "[edit]" };
    }
    if ((m = cmd.match(/^delete routing-options static route (\S+)(?: next-hop (\S+))?$/i))) {
      if (!isPrefix(m[1])) return { text: `error: invalid prefix '${m[1]}' (a.b.c.d/길이 형식으로 쓰세요)`, err: true };
      if (!applyPending(Object.assign({}, c, { pending: [] })).some(r => r.p === m[1]) && !c.pending.some(o => o.op === "set" && o.p === m[1])) return { text: `warning: statement not found`, err: true };
      c.pending.push({ op: "delete", p: m[1], nh: m[2] || "" }); return { text: "[edit]" };
    }
    if (/^show \| compare$/i.test(cmd)) {
      const next = applyPending(c), cur = c.routes, out = [];
      cur.filter(r => !next.some(n => n.p === r.p && n.nh === r.nh)).forEach(r => out.push("-" + routeText(r)));
      next.filter(n => !cur.some(r => n.p === r.p && n.nh === r.nh)).forEach(n => out.push("+" + routeText(n)));
      return { text: out.length ? "[edit routing-options static]\n" + out.join("\n") : "" };
    }
    if (/^commit(?: check)?$/i.test(cmd)) {
      if (/check/i.test(cmd)) return { text: "configuration check succeeds" };
      const had = c.routes.some(r => r.p === "0.0.0.0/0"); c.routes = applyPending(c); c.pending = [];
      const lost = had && !c.routes.some(r => r.p === "0.0.0.0/0");
      return { text: "commit complete" + (lost ? "\n[연습] 기본 경로(0.0.0.0/0)가 없어졌습니다. 실제 장비라면 다른 경로로 나가던 트래픽이 끊길 수 있습니다. 작업 승인과 되돌리는 방법(commit confirmed)을 먼저 확인하세요." : ""), warn: lost };
    }
    if (/^rollback(?: 0)?$/i.test(cmd)) { c.pending = []; return { text: "load complete" }; }
    if ((m = cmd.match(/^run (.+)$/i))) return { inner: m[1] };
    return null;
  }
  function vendorExtra(cmd, d) {
    let m;
    if (d.vendor === "cisco") {
      if ((m = cmd.match(/^show running-config interface (?:ethernet|eth) ?(\d+)\/(\d+)$/i)) || (m = cmd.match(/^show running-config interface (Te\d+\/0\/\d+)$/i) && [null, ...(cmd.match(/Te(\d+)\/0\/(\d+)/i) || []).slice(1)])) {
        const f = findIf(d, `Te${m[1]}/0/${m[2]}`); if (!f) return { text: "% Invalid range at '^' marker.", err: true };
        const v = vlanOf(f);
        return { text: `!Command: show running-config interface ${ethName(f[0])}\n!Running configuration last done at: ${nowStr()} KST\n!Time: ${nowStr()} KST\n\nversion 9.3(8)\n\ninterface ${ethName(f[0])}\n  description ${descOf(d, f)}\n` + (v ? `  switchport\n  switchport access vlan ${v}\n` : f[7] ? `  no switchport\n  ip address ${f[7]}/30\n` : `  switchport\n`) + (f[6] === "down" ? "  shutdown\n" : "  no shutdown\n") };
      }
      if ((m = cmd.match(/^show running-config interface vlan ?(\d+)$/i))) {
        const v = vlansOf(d).find(x => x.id === +m[1]); if (!v) return { text: "% Invalid range at '^' marker.\n[연습] 이 장비에 없는 VLAN입니다. 이 장비의 VLAN: " + (vlansOf(d).map(x => x.id).join(", ") || "(없음)") + " (show vlan brief 로 확인)", err: true };
        return { text: `!Command: show running-config interface Vlan${v.id}\n!Time: ${nowStr()} KST\n\nversion 9.3(8)\n\ninterface Vlan${v.id}\n  description ${v.cust}\n  no shutdown\n  ip address 10.${200 + (v.id - 100) % 50}.0.1/24\n` };
      }
      if (/^show vlan brief$/i.test(cmd)) {
        const vl = vlansOf(d), used = new Set(vl.flatMap(v => v.ports.map(f => f[0])));
        const portsTxt = ps => { const s = ps.map(f => ethName(f[0]).replace("Ethernet", "Eth")); const out = []; let line = ""; s.forEach(x => { if ((line + x).length > 30) { out.push(line.replace(/, $/, "")); line = ""; } line += x + ", "; }); if (line) out.push(line.replace(/, $/, "")); return out; };
        const row = (id, name, st, ps) => { const p = portsTxt(ps); return `${pad(id, 4)} ${pad(name, 32)} ${pad(st, 9)} ${p[0] || ""}` + p.slice(1).map(x => `\n${" ".repeat(48)}${x}`).join(""); };
        return { text: "VLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n" + row(1, "default", "active", sortedIfs(d).filter(f => !used.has(f[0]) && !f[7] && !f[10] && ethName(f[0]) !== f[0])) + (vl.length ? "\n" : "") + vl.map(v => row(v.id, "VLAN" + String(v.id).padStart(4, "0"), "active", v.ports)).join("\n") };
      }
    }
    if (d.vendor === "huawei") {
      if ((m = cmd.match(/^display current-configuration interface (.+)$/i))) {
        const f = findIf(d, m[1].replace(/\s+/g, "")); if (!f) return { text: "Error: Wrong parameter found at '^' position.", err: true };
        const v = vlanOf(f), all = vlansOf(d).map(x => x.id).join(" ");
        return { text: `#\ninterface ${f[0]}\n description ${descOf(d, f)}\n` + (v ? ` port link-type access\n port default vlan ${v}\n` : ` port link-type trunk\n port trunk allow-pass vlan ${all || "1"}\n`) + (f[6] === "down" ? " shutdown\n" : "") + "#" };
      }
      if (/^display vlan$/i.test(cmd)) {
        const vl = vlansOf(d), xge = f => f[0].replace("XGigabitEthernet", "XGE"), used = new Set(vl.flatMap(v => v.ports.map(f => f[0])));
        const rows = [`1    common  UT:${sortedIfs(d).filter(f => !used.has(f[0])).map(f => xge(f) + "(" + (f[5] === "up" ? "U" : "D") + ")").join(" ") || "-"}`].concat(vl.map(v => `${pad(v.id, 4)} common  UT:${v.ports.map(f => xge(f) + "(" + (f[5] === "up" ? "U" : "D") + ")").join(" ")}`));
        return { text: `The total number of vlans is : ${rows.length}\n--------------------------------------------------------------------------------\nU: Up         D: Down       TG: Tagged        UT: Untagged\n--------------------------------------------------------------------------------\nVID  Type    Ports\n--------------------------------------------------------------------------------\n` + rows.join("\n") };
      }
    }
    return null;
  }
  function exec(cmd, d, lib, viaRun) {
    const risk = RISK.find(x => x.v === S.vendor && x.cmd.toLowerCase() === cmd.toLowerCase());
    if (risk) return { text: `[연습] 위험한 명령입니다: ${risk.what}\n${risk.risk}\n\n연습 모드에서는 아무 일도 일어나지 않았고 기록도 남지 않았습니다. 실제 장비에서는 절대 함부로 치지 마세요.`, warn: true };
    if (d.vendor === "juniper") { const r = junosExtra(cmd, d); if (r && r.inner) return exec(r.inner, d, lib, true); if (r) return r; }
    const own = lib.find(x => x.own && x.text.toLowerCase() === cmd.toLowerCase());
    if (own) return { text: OUT[own.own](d) };
    const ve = vendorExtra(cmd, d); if (ve) return ve;
    for (const [re, fn] of DEV_CMDS[d.vendor]) { const m = cmd.match(re); if (m) { const t = withTime(termMs(), () => fn(d, m)) || "(출력 없음)"; return { text: d.vendor === "juniper" && cfgOf(d).mode && !viaRun ? t + "\n[연습] 실제 장비의 설정 모드에서는 이 명령 앞에 \"run \"을 붙여야 합니다 (예: run " + cmd + ")." : t }; } }
    const sg = suggest(cmd, lib), hint = /routing options|routing-option /i.test(cmd) ? "\n\n힌트: routing-options 는 하이픈(-)으로 붙여 씁니다." : "";
    return { text: VENDOR_ERR[d.vendor] + hint + (sg.length ? "\n\n혹시 이 명령이 아닌가요?\n" + sg.map(x => "  " + x).join("\n") : "\n\n\"?\"를 입력하거나 왼쪽 명령어 사전을 보세요."), err: true };
  }
  function run(raw) {
    const d = dev(), cmd = raw.trim().replace(/\s+/g, " "), lib = libFor();
    if (!cmd) return { text: "" };
    S.hist.push(cmd); S.hp = S.hist.length;
    if (cmd === "?" || /^help$/i.test(cmd)) return { text: "명령어를 입력하세요. 왼쪽 \"명령어 사전\"에서 골라 입력할 수도 있고, 앞부분만 치고 Tab 키를 누르면 이어서 채워 줍니다.\n예) \"show ?\" 처럼 물음표를 붙이면 그 뒤에 올 수 있는 명령을 보여 줍니다." };
    if (/ \?$/.test(cmd)) { const pre = cmd.slice(0, -2).toLowerCase(); const m = lib.filter(x => x.text.toLowerCase().startsWith(pre + " ")); return { text: m.length ? "가능한 명령:\n" + m.map(x => "  " + x.text.slice(pre.length + 1) + "   — " + x.what).join("\n") : "(그 뒤에 올 명령이 사전에 없습니다)" }; }
    return exec(cmd, d, lib, false);
  }
  function tabComplete(v) {   // 명령 낱말은 이어서 채우고, 포트·IP 칸에서는 이 장비의 실제 포트·IP 목록으로 채운다 (실제 장비의 Tab처럼 공통 부분까지 채우고 목록을 보여 줌)
    const d = dev(), low = v.toLowerCase(), cands = new Set(), argInfo = new Map(), ifs = sortedIfs(d);
    const vals = { eport: ifs.filter(f => /^Te\d+\/0\/\d+$/.test(f[0])).map(f => ["ethernet " + ethName(f[0]).replace("Ethernet", ""), f]), vlan: vlansOf(d).map(v => ["vlan" + v.id, ["", v.cust, 0, 0, null, "", "", "", ""]]), port: ifs.map(f => [f[0], f]), hwport: ifs.map(f => [f[0].replace("XGigabitEthernet", "XGigabitEthernet "), f]), ip: ifs.filter(f => f[8]).map(f => [f[8], f]) };
    LIB.filter(x => x.v === S.vendor).forEach(x => {
      const m = x.cmd.match(/\{(port|ip|hwport|eport|vlan)\}/);
      if (!m) { if (x.cmd.toLowerCase().startsWith(low)) cands.add(x.cmd); return; }
      const pre = x.cmd.slice(0, m.index), post = x.cmd.slice(m.index + m[0].length);
      if (low.startsWith(pre.toLowerCase())) { const part = low.slice(pre.length); vals[m[1]].filter(([p]) => p.toLowerCase().startsWith(part)).forEach(([p, f]) => { cands.add(pre + p + post); argInfo.set(pre + p + post, [p, f]); }); }
      else if (pre.toLowerCase().startsWith(low)) cands.add(pre);
    });
    const all = [...cands]; if (!all.length) return { value: v };
    let p = all[0]; all.forEach(c => { while (!c.toLowerCase().startsWith(p.toLowerCase())) p = p.slice(0, -1); });
    const value = p.length >= v.length ? p : v;
    if (all.length === 1) return { value: all[0] };
    const fromArgs = all.every(c => argInfo.has(c));
    const list = fromArgs ? [...new Map(all.map(c => [argInfo.get(c)[0], argInfo.get(c)[1]])).entries()].map(([name, f]) => `${pad(name, 24)} ${pad(f[5], 5)} ${f[1] || ""}`.trimEnd()) : all;
    return { value, list };
  }

  /* ---------- 화면 ---------- */
  function renderDevices() {
    const sel = document.getElementById("prDev");
    sel.innerHTML = DEVICES.filter(d => d.vendor === S.vendor).map(d => `<option value="${d.id}">${d.id}</option>`).join("");
    if (!DEV[S.dev] || DEV[S.dev].vendor !== S.vendor) S.dev = sel.value; else sel.value = S.dev;
  }
  function renderLib() {
    const q = document.getElementById("prSearch").value.trim().toLowerCase(), lib = libFor().filter(x => !q || (x.text + " " + x.what + " " + x.cat).toLowerCase().includes(q));
    document.getElementById("prLib").innerHTML = CATS.map(cat => {
      const items = lib.filter(x => x.cat === cat); if (!items.length) return "";
      return `<div class="pr-cat"><h4>${cat} <span class="muted">${items.length}</span></h4>` + items.map(x => `<button type="button" class="pr-item" data-cmd="${esc(x.text)}" data-tip-t="${esc(x.what)}" data-tip-a="${esc(x.risk || x.what)}"${x.read ? ` data-tip-b="${esc(x.read)}"` : ""}><code>${esc(x.text)}</code><span class="why">${esc(x.what)}</span></button>`).join("") + "</div>";
    }).join("") || '<p class="muted">검색 결과가 없습니다.</p>';
  }
  function reset(keepHist) {
    if (!keepHist) S.hist = [];
    const d = dev();
    document.getElementById("prOut").innerHTML = `<span class="muted">연습 모드: ${esc(d.id)} (${d.vendor}) — 실제 장비가 아닙니다. 친 명령은 저장되지 않고 접속 계정 이름도 남지 않습니다.\n"?"를 입력하면 도움말, 앞부분만 치고 Tab 키를 누르면 이어서 채워집니다.</span>\n`;
    document.getElementById("prPrompt").textContent = prompt(d);
  }
  pane.innerHTML = `<div class="pr-banner"><b>연습 모드</b> — 여기서 친 명령은 <b>어디에도 저장되지 않고</b>, 접속 계정 이름도 남지 않습니다. 화면을 나가거나 새로고침하면 모두 사라집니다. 실제 장비는 설정에 따라 누가 어떤 명령을 쳤는지 로그에 남을 수 있으니, 틀려 보는 연습은 여기서 마음껏 하세요. <span class="muted">(출력은 전부 가상이고 실제 장비와 다를 수 있습니다)</span><br>Juniper는 <code>configure</code>를 치면 설정 모드(프롬프트가 # 으로 바뀜)에서 <code>set</code>·<code>delete</code>·<code>commit</code>(정적 경로)을 연습할 수 있습니다. 실제로 적용되는 것이 아니고 이 화면을 나가면 원래대로 돌아갑니다.<br>포트 이름이 들어가는 명령(예: <code>show interfaces diagnostics optics</code>)은 포트 칸에서 <b>Tab</b>을 누르면 이 장비의 포트 목록이 나오고, 앞부분을 쓰고 Tab을 누르면 이어서 채워집니다.</div>
    <div class="pr-cols">
      <div class="card"><h3>명령어 사전 <small class="muted">(눌러서 입력창에 채우기 · 마우스를 올리면 설명)</small></h3>
        <input type="search" id="prSearch" placeholder="명령이나 설명으로 찾기 (예: 로그, CRC, 광)" autocomplete="off" spellcheck="false" style="width:100%">
        <div class="pr-lib" id="prLib"></div></div>
      <div class="card"><h3>연습용 터미널</h3>
        <div class="toolbar"><label>제조사 <select id="prVendor"><option value="juniper">Juniper</option><option value="cisco">Cisco</option><option value="huawei">Huawei</option></select></label> <label>장비 <select id="prDev"></select></label> <button class="btn" id="prClear" type="button">화면 지우기</button></div>
        <div class="term" id="prOut"></div>
        <div class="termin"><span class="p" id="prPrompt"></span><input type="text" id="prIn" autocomplete="off" spellcheck="false" placeholder="명령 입력 후 Enter (? 도움말 · Tab 자동 완성 · 위/아래 화살표)"></div>
      </div></div>`;
  const cur = devNow(); S.vendor = cur.vendor; S.dev = cur.id;
  document.getElementById("prVendor").value = S.vendor; renderDevices(); renderLib(); reset();
  document.getElementById("prVendor").onchange = e => { S.vendor = e.target.value; S.dev = null; renderDevices(); renderLib(); reset(true); };
  document.getElementById("prDev").onchange = e => { S.dev = e.target.value; reset(true); renderLib(); };
  document.getElementById("prSearch").oninput = renderLib;
  document.getElementById("prClear").onclick = () => reset(true);
  document.getElementById("prLib").addEventListener("click", e => { const b = e.target.closest("[data-cmd]"); if (b) { const i = document.getElementById("prIn"); i.value = b.dataset.cmd; i.focus(); } });
  document.getElementById("prIn").addEventListener("keydown", e => {
    const i = e.target;
    if (e.key === "Enter") {
      const v = i.value, before = prompt(dev()), r = run(v), d = dev(); i.value = "";
      const shown = before;   // 명령을 치기 전의 프롬프트로 한 줄을 남기고, 설정 모드가 바뀌었으면 입력 줄의 프롬프트를 갱신한다
      print(`<span class="p">${esc(shown)}</span> <span class="c">${esc(v)}</span>\n${r.err || r.warn ? `<span class="${r.err ? "e" : "w"}">${esc(r.text)}</span>` : esc(r.text)}\n`);
      document.getElementById("prPrompt").textContent = prompt(d);
    } else if (e.key === "Tab") { e.preventDefault(); const t = tabComplete(i.value); i.value = t.value; if (t.list) print(`<span class="muted">${esc(t.list.join("\n"))}</span>\n`); }
    else if (e.key === "ArrowUp" && S.hist.length) { S.hp = Math.max(0, S.hp - 1); i.value = S.hist[S.hp]; e.preventDefault(); }
    else if (e.key === "ArrowDown" && S.hist.length) { S.hp = Math.min(S.hist.length, S.hp + 1); i.value = S.hist[S.hp] || ""; e.preventDefault(); }
  });
  window.PRACTICE = { run, tabComplete, libFor, get state() { return S; }, get lib() { return LIB; } };
})();
