// 내집멘토부동산 · 아산 둔포면 부동산 대시보드 로컬 서버
// 실행: node server.mjs          →  http://localhost:8787
//       node server.mjs --build  →  최근 36개월 자료를 받아 snapshot.js 만 만들고 종료 (GitHub Actions용)
// 공공데이터포털(국토교통부 실거래가) / 한국부동산원 R-ONE API를 프록시하고 디스크에 캐시합니다.
// API 키는 환경변수(DATA_GO_KEY, REB_KEY) 또는 config.local.json 에서 읽습니다. (저장소에 올리지 않음)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const LOCAL_CFG = (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'config.local.json'), 'utf8')); } catch { return {}; } })();
const DATA_GO_KEY = process.env.DATA_GO_KEY || LOCAL_CFG.DATA_GO_KEY;
const REB_KEY = process.env.REB_KEY || LOCAL_CFG.REB_KEY;
if (!DATA_GO_KEY || !REB_KEY) {
  console.error('API 키가 없습니다. config.local.example.json 을 config.local.json 으로 복사하고 키를 넣어 주세요.');
  process.exit(1);
}
const LAWD_CD = '44200';           // 충남 아산시
const UMD_PREFIX = '둔포면';        // 둔포면만 추출
const CACHE_DIR = path.join(DIR, 'cache');
const SNAPSHOT_MONTHS = 37;
fs.mkdirSync(CACHE_DIR, { recursive: true });

const SVC = {
  trade: 'RTMSDataSvcAptTrade',
  rent: 'RTMSDataSvcAptRent',
};

const parseItems = xml => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m =>
  Object.fromEntries([...m[1].matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(a => [a[1], a[2].trim()])));
const num = s => +String(s || '').replace(/,/g, '') || 0;

// 지난 달 이전 데이터는 거의 변하지 않으므로 길게, 최근 2개월은 6시간만 캐시
function cacheTtl(ym) {
  const now = new Date();
  const cur = now.getFullYear() * 100 + now.getMonth() + 1;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYm = prev.getFullYear() * 100 + prev.getMonth() + 1;
  return (+ym >= prevYm || +ym >= cur) ? 6 * 3600e3 : 30 * 24 * 3600e3;
}

function readCache(file, ttl) {
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < ttl) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { }
  return null;
}

const inflight = new Map();
async function fetchRtms(type, ym) {
  const file = path.join(CACHE_DIR, `${type}_${ym}.json`);
  const hit = readCache(file, cacheTtl(ym));
  if (hit) return hit;
  const key = type + ym;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const svc = SVC[type];
    const all = [];
    for (let page = 1; page < 30; page++) {
      const url = `https://apis.data.go.kr/1613000/${svc}/get${svc}?serviceKey=${DATA_GO_KEY}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`;
      const xml = await (await fetch(url)).text();
      const code = (xml.match(/<resultCode>(\w+)/) || [])[1];
      if (code && code !== '000' && code !== '00') throw new Error('RTMS ' + code + ' ' + (xml.match(/<resultMsg>([^<]*)/) || [])[1]);
      all.push(...parseItems(xml));
      const total = +((xml.match(/<totalCount>(\d+)/) || [])[1] || 0);
      if (all.length >= total) break;
    }
    const rows = all.filter(i => (i.umdNm || '').startsWith(UMD_PREFIX)).map(i => {
      const base = {
        apt: i.aptNm, ri: (i.umdNm || '').replace(UMD_PREFIX, '').trim(), jibun: i.jibun,
        by: +i.buildYear || null, ar: +i.excluUseAr, fl: +i.floor || null,
        d: `${i.dealYear}-${String(i.dealMonth).padStart(2, '0')}-${String(i.dealDay).padStart(2, '0')}`,
      };
      if (type === 'trade') return { ...base, amt: num(i.dealAmount), cancel: !!(i.cdealType && i.cdealType !== ''), gbn: i.dealingGbn };
      return { ...base, dep: num(i.deposit), mon: num(i.monthlyRent), ctype: i.contractType, term: i.contractTerm };
    });
    fs.writeFileSync(file, JSON.stringify(rows));
    scheduleSnapshot();
    return rows;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// 한국부동산원 R-ONE: 통계표ID + 주기 + 분류ID 로 전체 시계열
async function fetchReb(id, cyc, cls) {
  const file = path.join(CACHE_DIR, `reb_${id}_${cyc}_${cls}.json`);
  const hit = readCache(file, 12 * 3600e3);
  if (hit) return hit;
  let rows = [];
  for (let p = 1; p < 10; p++) {
    const url = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?KEY=${REB_KEY}&Type=json&pIndex=${p}&pSize=1000&STATBL_ID=${id}&DTACYCLE_CD=${cyc}&CLS_ID=${cls}`;
    const j = await (await fetch(url)).json();
    const body = j.SttsApiTblData;
    if (!body) throw new Error('REB ' + JSON.stringify(j).slice(0, 200));
    const r = body[1]?.row || [];
    rows.push(...r);
    if (rows.length >= (body[0].head[0].list_total_count || 0) || !r.length) break;
  }
  rows = rows.map(r => ({ t: r.WRTTIME_IDTFR_ID, desc: r.WRTTIME_DESC, itm: r.ITM_NM, v: +r.DTA_VAL, name: r.CLS_FULLNM }))
    .sort((a, b) => a.t.localeCompare(b.t));
  fs.writeFileSync(file, JSON.stringify(rows));
  scheduleSnapshot();
  return rows;
}

// 서버 없이 index.html을 직접 열어도 보이도록 캐시를 snapshot.js 로 묶어 둠
let snapTimer;
function buildSnapshot() {
  const snap = { built: new Date().toISOString(), months: {}, reb: {} };
  // 스냅샷에는 최근 SNAPSHOT_MONTHS 개월만 담음
  const d0 = new Date(); d0.setMonth(d0.getMonth() - SNAPSHOT_MONTHS + 1);
  const minYm = `${d0.getFullYear()}${String(d0.getMonth() + 1).padStart(2, '0')}`;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const rows = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
    let m;
    if ((m = f.match(/^(trade|rent)_(\d{6})\.json$/)) && m[2] >= minYm) (snap.months[m[2]] = snap.months[m[2]] || { trade: [], rent: [] })[m[1]] = rows;
    else if ((m = f.match(/^reb_(.+)\.json$/))) snap.reb[m[1]] = rows;
  }
  fs.writeFileSync(path.join(DIR, 'snapshot.js'), 'window.SNAPSHOT = ' + JSON.stringify(snap) + ';\n');
}
const scheduleSnapshot = () => { clearTimeout(snapTimer); snapTimer = setTimeout(buildSnapshot, 3000); };

// 지도 타일: OSM 이용정책(식별 가능한 User-Agent, 캐시)에 맞춰 서버가 대신 받아 30일 캐시
const TILE_DIR = path.join(DIR, 'tile-cache');
const tileInflight = new Map();
async function sendTile(res, z, x, y) {
  const file = path.join(TILE_DIR, z, x, y + '.png');
  let buf = readTile(file);
  if (!buf) {
    const key = `${z}/${x}/${y}`;
    if (!tileInflight.has(key)) tileInflight.set(key, (async () => {
      const r = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { headers: { 'User-Agent': 'NaejipMentorDunpoDashboard/1.0 (local real-estate briefing; tel 041-545-7771)' } });
      if (!r.ok) throw new Error('tile ' + r.status);
      const b = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, b);
      return b;
    })().finally(() => tileInflight.delete(key)));
    buf = await tileInflight.get(key);
  }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
  res.end(buf);
}
function readTile(file) {
  try { if (Date.now() - fs.statSync(file).mtimeMs < 30 * 24 * 3600e3) return fs.readFileSync(file); } catch { }
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/rtms') {
      const type = u.searchParams.get('type');
      const months = (u.searchParams.get('months') || '').split(',').filter(m => /^\d{6}$/.test(m));
      if (!SVC[type] || !months.length) return send(res, 400, { error: 'type/months 필요' });
      const out = {};
      // 공공데이터포털 동시 요청 제한을 피하려고 3개씩 처리
      for (let i = 0; i < months.length; i += 3) {
        const chunk = months.slice(i, i + 3);
        const got = await Promise.all(chunk.map(m => fetchRtms(type, m).catch(e => ({ error: e.message }))));
        chunk.forEach((m, k) => out[m] = got[k]);
      }
      return send(res, 200, out);
    }
    if (u.pathname === '/api/reb') {
      const id = u.searchParams.get('id'), cyc = u.searchParams.get('cyc'), cls = u.searchParams.get('cls');
      if (!/^[\w]+$/.test(id + cyc + cls)) return send(res, 400, { error: 'id/cyc/cls 필요' });
      return send(res, 200, await fetchReb(id, cyc, cls));
    }
    const tm = u.pathname.match(/^\/tiles\/(\d{1,2})\/(\d+)\/(\d+)\.png$/);
    if (tm) return sendTile(res, ...tm.slice(1));
    let p = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
    const file = path.join(DIR, path.normalize(p).replace(/^([/\\])+/, ''));
    if (!file.startsWith(DIR) || file.includes(CACHE_DIR) || file.includes(TILE_DIR) || file.endsWith('.mjs') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

// 화면(index.html loadReb)에서 쓰는 부동산원 통계 목록과 같아야 함
const REB_SERIES = [
  ['T244183132827305', 'WK', '50200'], ['T247713133046872', 'WK', '50200'], ['T244183132827305', 'WK', '50001'],
  ['T237973129847263', 'MM', '50138'], ['A_2024_00549', 'MM', '510157'], ['T248163133074619', 'WK', '50036'],
];

if (process.argv.includes('--build')) {
  const now = new Date();
  const months = Array.from({ length: SNAPSHOT_MONTHS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  for (const m of months) for (const t of Object.keys(SVC)) await fetchRtms(t, m);
  for (const s of REB_SERIES) await fetchReb(...s);
  clearTimeout(snapTimer);
  buildSnapshot();
  console.log(`snapshot.js 생성 완료 (${months.at(-1)} ~ ${months[0]})`);
} else {
  server.listen(PORT, () => { buildSnapshot(); console.log(`둔포 부동산 대시보드: http://localhost:${PORT}`); });
}
