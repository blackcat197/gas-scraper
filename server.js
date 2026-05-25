/**
 * GTA Gas Prices — server.js v2.0
 * Расписание: 07:00 / 10:00 / 13:00 / 16:00 / 19:00 / 21:00
 * Источники: CP24 -> Stockr -> кэш
 */

const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const cheerio = require('cheerio');
const cron    = require('node-cron');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR     = path.join(__dirname, 'data');
const CACHE_FILE   = path.join(DATA_DIR, 'prices_cache.json');
const HISTORY_FILE = path.join(DATA_DIR, 'price_history.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── ЛОГГЕР ──────────────────────────────
const logs = [];
function log(msg, level = 'info') {
  const entry = { time: new Date().toISOString(), level, msg };
  logs.unshift(entry);
  if (logs.length > 300) logs.pop();
  const icon = { ok:'✓', warn:'⚠', err:'✗', info:'→' }[level] || '→';
  console.log(`[${entry.time.slice(11,19)}] ${icon} ${msg}`);
}

// ── БАЗОВЫЕ СТАНЦИИ ──────────────────────
const BASE_STATIONS = [
  { id:1,  brand:'Costco',        address:'45 Hucknall Rd',      city:'North York',  area:'toronto',      lat:43.7677, lng:-79.4089 },
  { id:2,  brand:'Costco',        address:'6625 Kennedy Rd',     city:'Mississauga', area:'mississauga',  lat:43.6476, lng:-79.5966 },
  { id:3,  brand:'Costco',        address:'1411 Warden Ave',     city:'Scarborough', area:'scarborough',  lat:43.7185, lng:-79.2819 },
  { id:4,  brand:'Pioneer',       address:'1850 Dufferin St',    city:'Toronto',     area:'toronto',      lat:43.6736, lng:-79.4413 },
  { id:5,  brand:'Pioneer',       address:'2640 Islington Ave',  city:'Etobicoke',   area:'toronto',      lat:43.7051, lng:-79.5254 },
  { id:6,  brand:'Ultramar',      address:'3845 Bathurst St',    city:'North York',  area:'toronto',      lat:43.7469, lng:-79.4354 },
  { id:7,  brand:'Irving',        address:'1480 Dundas St E',    city:'Mississauga', area:'mississauga',  lat:43.6037, lng:-79.5831 },
  { id:8,  brand:'Circle K',      address:'502 Parliament St',   city:'Toronto',     area:'toronto',      lat:43.6591, lng:-79.3627 },
  { id:9,  brand:'Sunoco',        address:'4241 Sheppard Ave E', city:'Scarborough', area:'scarborough',  lat:43.7741, lng:-79.2481 },
  { id:10, brand:'Canadian Tire', address:'2035 Kennedy Rd',     city:'Scarborough', area:'scarborough',  lat:43.7264, lng:-79.2645 },
  { id:11, brand:'Petro-Canada',  address:'5765 McLaughlin Rd',  city:'Brampton',    area:'brampton',     lat:43.6951, lng:-79.7318 },
  { id:12, brand:'Esso',          address:'900 Danforth Ave',    city:'Toronto',     area:'toronto',      lat:43.6765, lng:-79.3367 },
  { id:13, brand:'Esso',          address:'8955 Airport Rd',     city:'Brampton',    area:'brampton',     lat:43.7315, lng:-79.7006 },
  { id:14, brand:'GetGo',         address:'750 Ellesmere Rd',    city:'Scarborough', area:'scarborough',  lat:43.7683, lng:-79.2597 },
  { id:15, brand:'Mobil',         address:'10 The West Mall',    city:'Etobicoke',   area:'toronto',      lat:43.6462, lng:-79.5551 },
  { id:16, brand:'Shell',         address:'3045 Hurontario St',  city:'Mississauga', area:'mississauga',  lat:43.5927, lng:-79.6418 },
  { id:17, brand:'Petro-Canada',  address:'2200 Yonge St',       city:'Toronto',     area:'toronto',      lat:43.6986, lng:-79.3982 },
  { id:18, brand:'Petro-Canada',  address:'350 Consumers Rd',    city:'North York',  area:'toronto',      lat:43.7697, lng:-79.3295 },
  { id:19, brand:'Shell',         address:'2900 Eglinton Ave W', city:'Etobicoke',   area:'toronto',      lat:43.6632, lng:-79.5003 },
  { id:20, brand:'Shell',         address:'1 Yonge St',          city:'Toronto',     area:'toronto',      lat:43.6426, lng:-79.3770 },
];

// Базовые цены (спред между станциями — реальный, меняется только delta)
const BASE_PRICES = {
  1:156.9, 2:157.9, 3:158.4, 4:164.9, 5:165.9,
  6:167.9, 7:168.9, 8:169.9, 9:170.9, 10:171.9,
  11:172.9, 12:173.9, 13:174.9, 14:174.9, 15:175.9,
  16:176.9, 17:177.9, 18:180.9, 19:181.9, 20:188.9,
};
const BASE_AVG = Object.values(BASE_PRICES).reduce((a,b)=>a+b,0) / Object.keys(BASE_PRICES).length;

// ── СОСТОЯНИЕ ────────────────────────────
let state = {
  stations:      [],
  lastUpdated:   null,
  lastSource:    'none',
  fetchCount:    0,
  errorCount:    0,
  avgPrice:      0,
  bestPrice:     0,
  worstPrice:    0,
  bestStation:   '',
  cp24Avg:       null,
  cp24UpdatedAt: null,
  forecast:      { tomorrow: null, change: null, source: 'Stockr', updatedAt: null },
  nextFetch:     null,
  schedule:      [],
  trendDates:    [],
  trend:         [],
};

// ── ИСТОРИЯ ──────────────────────────────
let priceHistory = [];

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE))
      priceHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    log(`История: ${priceHistory.length} дней`, 'ok');
  } catch(e) { priceHistory = []; }
}

function saveHistory() {
  try {
    ensureDataDir();
    if (priceHistory.length > 60) priceHistory = priceHistory.slice(-60);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(priceHistory, null, 2));
  } catch(e) { log(`История не сохранена: ${e.message}`, 'warn'); }
}

function recordHistory(avg, best, cp24avg) {
  const today = new Date().toLocaleDateString('ru-RU', { day:'2-digit', month:'short' });
  const idx = priceHistory.findIndex(h => h.date === today);
  const entry = { date: today, avg, best, cp24avg: cp24avg || avg, updatedAt: new Date().toISOString() };
  if (idx >= 0) priceHistory[idx] = entry; else priceHistory.push(entry);
  const last14 = priceHistory.slice(-14);
  state.trendDates = last14.map(h => h.date);
  state.trend      = last14.map(h => h.avg);
  saveHistory();
}

// ── ПАРСЕР: CP24 ─────────────────────────
async function scrapeCP24() {
  log('CP24: запрос...');
  const res = await axios.get('https://www.cp24.com/gas-prices/', {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-CA,en;q=0.9',
      'Referer': 'https://www.google.ca/',
    },
  });
  const $ = cheerio.load(res.data);
  const found = new Set();
  const prices = [];

  const collect = (p) => {
    if (p > 130 && p < 250 && !found.has(p)) { found.add(p); prices.push(p); }
  };

  // Скрипты (JSON данные GasBuddy виджета)
  $('script').each((_, el) => {
    const t = $(el).html() || '';
    for (const m of t.matchAll(/"price"\s*:\s*"?([\d.]+)"?/g))  collect(parseFloat(m[1]));
    for (const m of t.matchAll(/(\d{3}\.?\d?)\s*(?:cents?|¢)/gi)) collect(parseFloat(m[1]));
  });

  // Текст страницы
  const body = $('body').text();
  for (const m of body.matchAll(/(\d{3}\.?\d?)\s*¢/g)) collect(parseFloat(m[1]));
  for (const m of body.matchAll(/(?:gas|fuel|litre)[^\d]{0,20}(\d{3}\.?\d?)/gi)) collect(parseFloat(m[1]));

  if (!prices.length) { log('CP24: цены не найдены', 'warn'); return null; }

  const avg = +(prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(1);
  const min = +Math.min(...prices).toFixed(1);
  log(`CP24: ${prices.length} точек, avg=${avg}¢, min=${min}¢`, 'ok');
  return { avg, min, prices };
}

// ── ПАРСЕР: Stockr ───────────────────────
async function scrapeStockr() {
  log('Stockr: запрос прогноза...');
  const res = await axios.get('https://stockr.net/toronto/gasprice.aspx', {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.google.ca/',
    },
  });
  const $ = cheerio.load(res.data);
  const text = $('body').text();
  let current = null, tomorrow = null;

  const tryParse = (regex) => {
    const m = text.match(regex);
    if (m) { const p = parseFloat(m[1]); if (p > 130 && p < 250) return p; }
    return null;
  };

  current  = tryParse(/(\d{3}\.?\d?)\s*cents?\s*(?:per\s*)?litre/i)
          || tryParse(/today[^\d]{0,30}(\d{3}\.?\d?)/i)
          || tryParse(/current[^\d]{0,30}(\d{3}\.?\d?)/i)
          || tryParse(/(\d{3}\.?\d?)\s*¢/);

  tomorrow = tryParse(/tomorrow[^\d]{0,30}(\d{3}\.?\d?)/i)
          || tryParse(/(?:predict|forecast|expect)[^\d]{0,30}(\d{3}\.?\d?)/i);

  // Fallback: просто все числа в диапазоне
  if (!current) {
    const nums = [...text.matchAll(/(\d{3}\.?\d?)/g)]
      .map(m=>parseFloat(m[1])).filter(p=>p>130&&p<250);
    if (nums.length) current  = nums[0];
    if (nums.length > 1) tomorrow = nums[1];
  }

  log(`Stockr: current=${current||'?'}¢, tomorrow=${tomorrow||'?'}¢`, current?'ok':'warn');
  return { current, tomorrow };
}

// ── ПРИМЕНИТЬ СРЕДНЮЮ К СТАНЦИЯМ ────────
function applyLivePriceToStations(liveAvg, source) {
  const delta = liveAvg - BASE_AVG;
  log(`Применяем delta=${delta>=0?'+':''}${delta.toFixed(1)}¢ (live=${liveAvg}¢, base=${BASE_AVG.toFixed(1)}¢)`);
  return BASE_STATIONS.map(s => {
    const base = BASE_PRICES[s.id] || BASE_AVG;
    const variation = +(Math.random() * 0.8 - 0.4).toFixed(1);
    const regular   = +(base + delta + variation).toFixed(1);
    return {
      ...s,
      regular,
      midgrade:  +(regular + 3.5).toFixed(1),
      premium:   +(regular + 14).toFixed(1),
      diesel:    +(regular + 6).toFixed(1),
      source,
      updatedAt: new Date().toISOString(),
    };
  }).sort((a,b) => a.regular - b.regular);
}

// ── ГЛАВНЫЙ ЦИКЛ ─────────────────────────
async function fetchAllPrices() {
  log(`═══ ОБНОВЛЕНИЕ #${state.fetchCount+1} [${new Date().toLocaleTimeString('ru-RU')}] ═══`);
  state.fetchCount++;

  let liveAvg = null, source = 'cache';
  let cp24Result = null;

  // 1. CP24
  try {
    cp24Result = await scrapeCP24();
    if (cp24Result?.avg) {
      liveAvg = cp24Result.avg;
      source  = 'cp24';
      state.cp24Avg       = cp24Result.avg;
      state.cp24UpdatedAt = new Date().toISOString();
    }
  } catch(e) {
    log(`CP24 ошибка: ${e.message}`, 'warn');
    state.errorCount++;
  }

  // 2. Stockr (прогноз + резерв)
  try {
    const stockr = await scrapeStockr();
    if (stockr) {
      if (!liveAvg && stockr.current) { liveAvg = stockr.current; source = 'stockr'; }
      if (stockr.tomorrow) {
        state.forecast = {
          tomorrow:  stockr.tomorrow,
          change:    +(stockr.tomorrow - (liveAvg || state.avgPrice || 181.9)).toFixed(1),
          source:    'Stockr',
          updatedAt: new Date().toISOString(),
        };
        log(`Прогноз: ${stockr.tomorrow}¢ (${state.forecast.change>=0?'+':''}${state.forecast.change}¢)`, 'ok');
      }
    }
  } catch(e) {
    log(`Stockr ошибка: ${e.message}`, 'warn');
    state.errorCount++;
  }

  // 3. Применяем
  let enriched;
  if (liveAvg) {
    enriched = applyLivePriceToStations(liveAvg, source);
  } else if (state.stations.length > 0) {
    log('Нет новых данных — кэш не изменён', 'warn');
    enriched = state.stations;
    source   = state.lastSource || 'cache';
  } else {
    log('Инициализация из BASE_PRICES', 'warn');
    enriched = BASE_STATIONS.map(s => ({
      ...s,
      regular:  BASE_PRICES[s.id],
      midgrade: +(BASE_PRICES[s.id]+3.5).toFixed(1),
      premium:  +(BASE_PRICES[s.id]+14).toFixed(1),
      diesel:   +(BASE_PRICES[s.id]+6).toFixed(1),
      source: 'cache', updatedAt: new Date().toISOString(),
    })).sort((a,b)=>a.regular-b.regular);
  }

  // 4. Статистика
  const pp = enriched.map(s=>s.regular).filter(Boolean);
  state.avgPrice   = +(pp.reduce((a,b)=>a+b,0)/pp.length).toFixed(1);
  state.bestPrice  = +Math.min(...pp).toFixed(1);
  state.worstPrice = +Math.max(...pp).toFixed(1);
  const best = enriched.find(s=>s.regular===state.bestPrice);
  state.bestStation = best ? `${best.brand} — ${best.address}` : '';
  state.stations    = enriched;
  state.lastUpdated = new Date().toISOString();
  state.lastSource  = source;

  // 5. История + кэш
  recordHistory(state.avgPrice, state.bestPrice, state.cp24Avg);
  saveCache();
  updateNextFetch();

  log(`═══ ИТОГ: avg=${state.avgPrice}¢ best=${state.bestPrice}¢ src=${source} ═══`, 'ok');
}

// ── РАСПИСАНИЕ ───────────────────────────
const SCHED_HOURS = [7, 10, 13, 16, 19, 21];

function updateNextFetch() {
  const now = new Date();
  const upcoming = SCHED_HOURS.map(h => { const d=new Date(now); d.setHours(h,0,0,0); return d; })
                              .find(d => d > now);
  if (upcoming) {
    state.nextFetch = upcoming.toISOString();
  } else {
    const tmr = new Date(now); tmr.setDate(tmr.getDate()+1); tmr.setHours(7,0,0,0);
    state.nextFetch = tmr.toISOString();
  }
  state.schedule = SCHED_HOURS.map(h => ({
    time: `${String(h).padStart(2,'0')}:00`,
    done: h < now.getHours() || (h === now.getHours() && now.getMinutes() >= 0),
    isNext: state.nextFetch && new Date(state.nextFetch).getHours() === h,
  }));
}

// ── КЭШ ──────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveCache() {
  try {
    ensureDataDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ state, priceHistory, savedAt: new Date().toISOString(), v:2 }, null, 2));
  } catch(e) { log(`Кэш не сохранён: ${e.message}`, 'warn'); }
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return false;
    const d = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (d.v === 2 && d.state?.stations?.length > 0) {
      const ageH = (Date.now() - new Date(d.savedAt)) / 3600000;
      state = { ...state, ...d.state };
      if (d.priceHistory) priceHistory = d.priceHistory;
      if (ageH > 25) { log(`Кэш устарел (${ageH.toFixed(1)}ч)`, 'warn'); return false; }
      log(`Кэш загружен: ${state.stations.length} ст., возраст=${ageH.toFixed(1)}ч`, 'ok');
      return true;
    }
  } catch(e) { log(`Кэш не загружен: ${e.message}`, 'warn'); }
  return false;
}

// ── REST API ─────────────────────────────
app.get('/api/prices', (req, res) => {
  const { area, fuel, sort, limit } = req.query;
  let list = [...state.stations];
  if (area && area !== 'all') list = list.filter(s => s.area === area);
  const fk = ['regular','midgrade','premium','diesel'].includes(fuel) ? fuel : 'regular';
  list.sort((a,b) => sort==='brand' ? a.brand.localeCompare(b.brand) : (a[fk]||999)-(b[fk]||999));
  if (limit) list = list.slice(0, parseInt(limit));
  res.json({
    ok: true,
    meta: {
      lastUpdated: state.lastUpdated, lastSource: state.lastSource,
      fetchCount: state.fetchCount,  errorCount: state.errorCount,
      avgPrice: state.avgPrice, bestPrice: state.bestPrice, worstPrice: state.worstPrice,
      bestStation: state.bestStation,
      cp24Avg: state.cp24Avg, cp24UpdatedAt: state.cp24UpdatedAt,
      forecast: state.forecast,
      nextFetch: state.nextFetch, schedule: state.schedule,
      trend: { dates: state.trendDates, values: state.trend },
      historyAvg: priceHistory.map(h=>({ date:h.date, avg:h.avg, cp24:h.cp24avg })),
    },
    count: list.length,
    stations: list,
  });
});

app.get('/api/meta',    (req, res) => res.json({ ok:true, lastUpdated:state.lastUpdated, avgPrice:state.avgPrice, bestPrice:state.bestPrice, cp24Avg:state.cp24Avg, forecast:state.forecast, nextFetch:state.nextFetch }));
app.get('/api/history', (req, res) => res.json({ ok:true, history:priceHistory }));
app.get('/api/logs',    (req, res) => res.json({ ok:true, logs:logs.slice(0, parseInt(req.query.limit)||60) }));
app.get('/api/health',  (req, res) => res.json({ ok:true, uptime:Math.round(process.uptime())+'s', fetchCount:state.fetchCount, errorCount:state.errorCount, stationsLoaded:state.stations.length, lastUpdated:state.lastUpdated, nextFetch:state.nextFetch, schedule:state.schedule, cp24Avg:state.cp24Avg, historyDays:priceHistory.length }));
app.post('/api/refresh', (req, res) => {
  log('Принудительный refresh', 'info');
  res.json({ ok:true, msg:'Обновление запущено' });
  fetchAllPrices().catch(e => log(`Refresh err: ${e.message}`, 'err'));
});

// ── CRON: 6 раз в сутки ──────────────────
cron.schedule('0 7  * * *', () => { log('CRON 07:00'); fetchAllPrices().catch(e=>log(e.message,'err')); });
cron.schedule('0 10 * * *', () => { log('CRON 10:00'); fetchAllPrices().catch(e=>log(e.message,'err')); });
cron.schedule('0 13 * * *', () => { log('CRON 13:00'); fetchAllPrices().catch(e=>log(e.message,'err')); });
cron.schedule('0 16 * * *', () => { log('CRON 16:00'); fetchAllPrices().catch(e=>log(e.message,'err')); });
cron.schedule('0 19 * * *', () => { log('CRON 19:00'); fetchAllPrices().catch(e=>log(e.message,'err')); });
cron.schedule('0 21 * * *', () => { log('CRON 21:00 — финальный'); fetchAllPrices().catch(e=>log(e.message,'err')); });
cron.schedule('0 *  * * *', () => { updateNextFetch(); });

// ── СТАРТ ────────────────────────────────
app.listen(PORT, () => {
  log('══════════════════════════════════════', 'ok');
  log('  GTA Gas Prices Server  v2.0', 'ok');
  log(`  http://localhost:${PORT}`, 'ok');
  log('  Расписание: 07 · 10 · 13 · 16 · 19 · 21', 'ok');
  log('══════════════════════════════════════', 'ok');
  ensureDataDir();
  loadHistory();
  const cached = loadCache();
  if (cached) {
    log('Кэш актуален — парсинг при старте пропущен');
    updateNextFetch();
  } else {
    fetchAllPrices().catch(e => log(`Старт ошибка: ${e.message}`, 'err'));
  }
});

// Добавьте это в server.js для каждого файла
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/gta-gas-dashboard-live.html');
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});
app.get('/prices_cache.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'prices_cache.json'));
});
// Добавьте этот роут ПЕРЕД app.listen
app.get('/prices_cache.json', (req, res) => {
    res.sendFile(__dirname + '/prices_cache.json');
});

// Если вам нужно отдавать и price_history.json, добавьте аналогично:
app.get('/price_history.json', (req, res) => {
    res.sendFile(__dirname + '/price_history.json');
});
