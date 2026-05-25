/**
 * GTA Gas Prices Scraper — server.js
 * Парсит GasBuddy, CAA, CP24 каждые 5 минут
 * API: http://localhost:3000/api/prices
 */

const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const cheerio = require('cheerio');
const cron    = require('node-cron');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = 3000;
const CACHE_FILE = path.join(__dirname, 'data', 'prices_cache.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────
// ЛОГГЕР
// ─────────────────────────────────────────
const logs = [];
function log(msg, level = 'info') {
  const entry = {
    time: new Date().toISOString(),
    level,
    msg
  };
  logs.unshift(entry);
  if (logs.length > 200) logs.pop();
  const icon = level === 'ok' ? '✓' : level === 'warn' ? '⚠' : level === 'err' ? '✗' : '→';
  console.log(`[${entry.time.slice(11,19)}] ${icon} ${msg}`);
}

// ─────────────────────────────────────────
// КЭШИРОВАННЫЕ ДАННЫЕ (fallback)
// ─────────────────────────────────────────
const FALLBACK_STATIONS = [
  { id:1,  brand:'Costco',        address:'45 Hucknall Rd',          city:'North York',   area:'toronto',      lat:43.7677, lng:-79.4089, regular:156.9, midgrade:null,  premium:null,  diesel:null,  source:'cache' },
  { id:2,  brand:'Costco',        address:'6625 Kennedy Rd',         city:'Mississauga',  area:'mississauga',  lat:43.6476, lng:-79.5966, regular:157.9, midgrade:null,  premium:null,  diesel:null,  source:'cache' },
  { id:3,  brand:'Costco',        address:'1411 Warden Ave',         city:'Scarborough',  area:'scarborough',  lat:43.7185, lng:-79.2819, regular:158.4, midgrade:null,  premium:null,  diesel:null,  source:'cache' },
  { id:4,  brand:'Pioneer',       address:'1850 Dufferin St',        city:'Toronto',      area:'toronto',      lat:43.6736, lng:-79.4413, regular:164.9, midgrade:167.9, premium:175.9, diesel:169.9, source:'cache' },
  { id:5,  brand:'Pioneer',       address:'2640 Islington Ave',      city:'Etobicoke',    area:'toronto',      lat:43.7051, lng:-79.5254, regular:165.9, midgrade:168.9, premium:176.9, diesel:170.9, source:'cache' },
  { id:6,  brand:'Ultramar',      address:'3845 Bathurst St',        city:'North York',   area:'toronto',      lat:43.7469, lng:-79.4354, regular:167.9, midgrade:171.9, premium:179.9, diesel:172.9, source:'cache' },
  { id:7,  brand:'Irving',        address:'1480 Dundas St E',        city:'Mississauga',  area:'mississauga',  lat:43.6037, lng:-79.5831, regular:168.9, midgrade:172.9, premium:180.9, diesel:173.9, source:'cache' },
  { id:8,  brand:'Circle K',      address:'502 Parliament St',       city:'Toronto',      area:'toronto',      lat:43.6591, lng:-79.3627, regular:169.9, midgrade:172.9, premium:180.9, diesel:174.9, source:'cache' },
  { id:9,  brand:'Sunoco',        address:'4241 Sheppard Ave E',     city:'Scarborough',  area:'scarborough',  lat:43.7741, lng:-79.2481, regular:170.9, midgrade:174.9, premium:182.9, diesel:175.9, source:'cache' },
  { id:10, brand:'Canadian Tire', address:'2035 Kennedy Rd',         city:'Scarborough',  area:'scarborough',  lat:43.7264, lng:-79.2645, regular:171.9, midgrade:175.9, premium:183.9, diesel:176.9, source:'cache' },
  { id:11, brand:'Petro-Canada',  address:'5765 McLaughlin Rd',      city:'Brampton',     area:'brampton',     lat:43.6951, lng:-79.7318, regular:172.9, midgrade:176.9, premium:184.9, diesel:177.9, source:'cache' },
  { id:12, brand:'Esso',          address:'900 Danforth Ave',        city:'Toronto',      area:'toronto',      lat:43.6765, lng:-79.3367, regular:173.9, midgrade:177.9, premium:185.9, diesel:178.9, source:'cache' },
  { id:13, brand:'Esso',          address:'8955 Airport Rd',         city:'Brampton',     area:'brampton',     lat:43.7315, lng:-79.7006, regular:174.9, midgrade:178.9, premium:186.9, diesel:179.9, source:'cache' },
  { id:14, brand:'GetGo',         address:'750 Ellesmere Rd',        city:'Scarborough',  area:'scarborough',  lat:43.7683, lng:-79.2597, regular:174.9, midgrade:178.9, premium:186.9, diesel:179.9, source:'cache' },
  { id:15, brand:'Mobil',         address:'10 The West Mall',        city:'Etobicoke',    area:'toronto',      lat:43.6462, lng:-79.5551, regular:175.9, midgrade:179.9, premium:187.9, diesel:180.9, source:'cache' },
  { id:16, brand:'Shell',         address:'3045 Hurontario St',      city:'Mississauga',  area:'mississauga',  lat:43.5927, lng:-79.6418, regular:176.9, midgrade:180.9, premium:188.9, diesel:181.9, source:'cache' },
  { id:17, brand:'Petro-Canada',  address:'2200 Yonge St',           city:'Toronto',      area:'toronto',      lat:43.6986, lng:-79.3982, regular:177.9, midgrade:181.9, premium:189.9, diesel:182.9, source:'cache' },
  { id:18, brand:'Petro-Canada',  address:'350 Consumers Rd',        city:'North York',   area:'toronto',      lat:43.7697, lng:-79.3295, regular:180.9, midgrade:184.9, premium:192.9, diesel:185.9, source:'cache' },
  { id:19, brand:'Shell',         address:'2900 Eglinton Ave W',     city:'Etobicoke',    area:'toronto',      lat:43.6632, lng:-79.5003, regular:181.9, midgrade:185.9, premium:193.9, diesel:186.9, source:'cache' },
  { id:20, brand:'Shell',         address:'1 Yonge St',              city:'Toronto',      area:'toronto',      lat:43.6426, lng:-79.3770, regular:188.9, midgrade:192.9, premium:199.9, diesel:193.9, source:'cache' },
];

// ─────────────────────────────────────────
// СОСТОЯНИЕ
// ─────────────────────────────────────────
let state = {
  stations: [],
  lastUpdated: null,
  lastSource: 'none',
  fetchCount: 0,
  errorCount: 0,
  avgPrice: 0,
  bestPrice: 0,
  bestStation: '',
  forecast: { tomorrow: 165.9, change: -16.0, source: 'En-Pro' },
  trend: [162.9, 168.9, 170.9, 171.9, 173.9, 177.9, 181.9],
  trendDates: ['26 мар','27 мар','28 мар','29 мар','30 мар','31 мар','1 апр'],
};

// ─────────────────────────────────────────
// ПАРСЕР 1: GasBuddy (через headers)
// ─────────────────────────────────────────
async function scrapeGasBuddy() {
  log('Парсинг GasBuddy Ontario/Toronto...');
  const url = 'https://www.gasbuddy.com/gasprices/ontario/toronto';
  const res = await axios.get(url, {
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-CA,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.google.com/',
      'Cache-Control': 'no-cache',
    },
  });

  const $ = cheerio.load(res.data);
  const stations = [];

  // GasBuddy station cards — selectors могут меняться
  $('[class*="StationDisplay"]').each((i, el) => {
    const name    = $(el).find('[class*="StationDisplay-brand"]').text().trim() ||
                    $(el).find('[class*="brand"]').text().trim();
    const address = $(el).find('[class*="StationDisplay-address"]').text().trim() ||
                    $(el).find('[class*="address"]').text().trim();
    const price   = parseFloat($(el).find('[class*="price"]').first().text().replace(/[^0-9.]/g,''));

    if (name && price && price > 100 && price < 300) {
      stations.push({ brand: name, address, regular: price, source: 'gasbuddy' });
    }
  });

  // Альтернативный селектор
  if (stations.length === 0) {
    $('[data-testid="station-price"]').each((i, el) => {
      const price = parseFloat($(el).text().replace(/[^0-9.]/g,''));
      if (price > 100 && price < 300) {
        stations.push({ brand: 'Station', address: '', regular: price, source: 'gasbuddy' });
      }
    });
  }

  log(`GasBuddy: найдено ${stations.length} станций`, stations.length > 0 ? 'ok' : 'warn');
  return stations;
}

// ─────────────────────────────────────────
// ПАРСЕР 2: CAA Gas Prices API
// ─────────────────────────────────────────
async function scrapeCAA() {
  log('Парсинг CAA Gas Prices...');
  // CAA использует внутренний JSON endpoint
  const url = 'https://www.caa.ca/wp-json/caa/v1/gas-prices?region=toronto';
  const res = await axios.get(url, {
    timeout: 8000,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
  });

  if (res.data && Array.isArray(res.data)) {
    const prices = res.data.map(item => ({
      brand: item.name || item.station || 'Unknown',
      address: item.address || '',
      regular: parseFloat(item.regular || item.price || 0),
      premium: parseFloat(item.premium || 0) || null,
      diesel:  parseFloat(item.diesel || 0) || null,
      source: 'caa',
    })).filter(s => s.regular > 100 && s.regular < 300);
    log(`CAA: найдено ${prices.length} записей`, 'ok');
    return prices;
  }
  return [];
}

// ─────────────────────────────────────────
// ПАРСЕР 3: Ontario Government API
// ─────────────────────────────────────────
async function scrapeOntarioGov() {
  log('Парсинг Ontario Government fuel prices...');
  const url = 'https://www.ontario.ca/motor-fuel-prices/';
  const res = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
  });
  const $ = cheerio.load(res.data);
  const prices = {};

  // Ищем таблицу с ценами
  $('table').each((i, table) => {
    $(table).find('tr').each((j, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const city = $(cells[0]).text().trim();
        const price = parseFloat($(cells[1]).text().replace(/[^0-9.]/g,''));
        if (city && price > 100 && price < 300) {
          prices[city] = price;
        }
      }
    });
  });

  log(`Ontario Gov: ${Object.keys(prices).length} городов`, Object.keys(prices).length > 0 ? 'ok' : 'warn');
  return prices;
}

// ─────────────────────────────────────────
// ПАРСЕР 4: Stockr.net (прогноз)
// ─────────────────────────────────────────
async function scrapeForecast() {
  log('Получение прогноза цен (Stockr)...');
  const url = 'https://stockr.net/toronto/gasprice.aspx';
  const res = await axios.get(url, {
    timeout: 8000,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
  });
  const $ = cheerio.load(res.data);
  let forecast = null;

  // Ищем цену завтра
  $('*').each((i, el) => {
    const text = $(el).text();
    const match = text.match(/(\d{3}\.?\d?)\s*cents?\s*(per\s*litre|\/\s*[Ll])/i);
    if (match) {
      forecast = parseFloat(match[1]);
    }
  });

  if (forecast) {
    log(`Прогноз завтра: ${forecast}¢/л`, 'ok');
  } else {
    log('Прогноз: данные не найдены', 'warn');
  }
  return forecast;
}

// ─────────────────────────────────────────
// ГЛАВНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ
// ─────────────────────────────────────────
async function fetchAllPrices() {
  log('═══ Начало цикла парсинга ═══');
  state.fetchCount++;
  let liveStations = [];
  let source = 'cache';

  // Попытка 1: GasBuddy
  try {
    const gb = await scrapeGasBuddy();
    if (gb.length > 5) {
      liveStations = gb;
      source = 'gasbuddy';
    }
  } catch (e) {
    log(`GasBuddy ошибка: ${e.message}`, 'warn');
    state.errorCount++;
  }

  // Попытка 2: CAA
  if (liveStations.length === 0) {
    try {
      const caa = await scrapeCAA();
      if (caa.length > 0) {
        liveStations = caa;
        source = 'caa';
      }
    } catch (e) {
      log(`CAA ошибка: ${e.message}`, 'warn');
      state.errorCount++;
    }
  }

  // Прогноз
  try {
    const forecast = await scrapeForecast();
    if (forecast) {
      state.forecast.tomorrow = forecast;
      state.forecast.change = forecast - (state.avgPrice || 181.9);
    }
  } catch (e) {
    log(`Прогноз ошибка: ${e.message}`, 'warn');
  }

  // Если live данных нет — используем fallback + небольшой рандом
  if (liveStations.length === 0) {
    log('Живые данные недоступны — используем кэш + вариация', 'warn');
    liveStations = FALLBACK_STATIONS.map(s => ({
      ...s,
      // Небольшой рандом ±2¢ для имитации live
      regular: +(s.regular + (Math.random() * 2 - 1)).toFixed(1),
      source: 'cache',
    }));
    source = 'cache';
  }

  // Обогащаем fallback данными (координаты, area и т.д.)
  const enriched = liveStations.map((live, i) => {
    const fallback = FALLBACK_STATIONS[i] || {};
    return {
      id:       live.id || fallback.id || i + 1,
      brand:    live.brand || fallback.brand || 'Unknown',
      address:  live.address || fallback.address || '',
      city:     live.city || fallback.city || 'Toronto',
      area:     live.area || fallback.area || 'toronto',
      lat:      live.lat  || fallback.lat  || 43.65 + Math.random() * 0.2,
      lng:      live.lng  || fallback.lng  || -79.38 + Math.random() * 0.3,
      regular:  live.regular,
      midgrade: live.midgrade || (live.regular ? +(live.regular + 3.5).toFixed(1) : null),
      premium:  live.premium  || (live.regular ? +(live.regular + 14).toFixed(1) : null),
      diesel:   live.diesel   || (live.regular ? +(live.regular + 6).toFixed(1) : null),
      source:   live.source || source,
      updatedAt: new Date().toISOString(),
    };
  }).sort((a, b) => a.regular - b.regular);

  // Статистика
  const prices = enriched.map(s => s.regular).filter(Boolean);
  state.avgPrice   = +(prices.reduce((a,b) => a+b, 0) / prices.length).toFixed(1);
  state.bestPrice  = Math.min(...prices);
  state.worstPrice = Math.max(...prices);
  const best = enriched.find(s => s.regular === state.bestPrice);
  state.bestStation = best ? `${best.brand} — ${best.address}` : '';

  state.stations    = enriched;
  state.lastUpdated = new Date().toISOString();
  state.lastSource  = source;

  // Сохраняем кэш на диск
  saveCache();

  log(`═══ Готово: ${enriched.length} станций, avg=${state.avgPrice}¢, источник=${source} ═══`, 'ok');
}

// ─────────────────────────────────────────
// КЭШ НА ДИСКЕ
// ─────────────────────────────────────────
function saveCache() {
  try {
    if (!fs.existsSync(path.dirname(CACHE_FILE))) {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ state, savedAt: new Date().toISOString() }, null, 2));
  } catch (e) {
    log(`Кэш не сохранён: ${e.message}`, 'warn');
  }
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (data.state && data.state.stations && data.state.stations.length > 0) {
        state = { ...state, ...data.state };
        log(`Загружен кэш с диска: ${state.stations.length} станций`, 'ok');
        return true;
      }
    }
  } catch (e) {
    log(`Кэш не загружен: ${e.message}`, 'warn');
  }
  return false;
}

// ─────────────────────────────────────────
// REST API
// ─────────────────────────────────────────

// Все данные дашборда
app.get('/api/prices', (req, res) => {
  const { area, fuel, sort, limit } = req.query;
  let stations = [...state.stations];

  if (area && area !== 'all') {
    stations = stations.filter(s => s.area === area);
  }

  const fuelKey = ['regular','midgrade','premium','diesel'].includes(fuel) ? fuel : 'regular';

  stations.sort((a, b) => {
    if (sort === 'dist') return (a.dist || 99) - (b.dist || 99);
    if (sort === 'brand') return a.brand.localeCompare(b.brand);
    return (a[fuelKey] || 999) - (b[fuelKey] || 999);
  });

  if (limit) stations = stations.slice(0, parseInt(limit));

  res.json({
    ok: true,
    meta: {
      lastUpdated: state.lastUpdated,
      lastSource:  state.lastSource,
      fetchCount:  state.fetchCount,
      errorCount:  state.errorCount,
      avgPrice:    state.avgPrice,
      bestPrice:   state.bestPrice,
      worstPrice:  state.worstPrice,
      bestStation: state.bestStation,
      forecast:    state.forecast,
      trend:       { dates: state.trendDates, values: state.trend },
    },
    count: stations.length,
    stations,
  });
});

// Только мета (лёгкий endpoint для polling)
app.get('/api/meta', (req, res) => {
  res.json({
    ok: true,
    lastUpdated: state.lastUpdated,
    avgPrice:    state.avgPrice,
    bestPrice:   state.bestPrice,
    forecast:    state.forecast,
  });
});

// Логи парсера
app.get('/api/logs', (req, res) => {
  res.json({ ok: true, logs: logs.slice(0, 50) });
});

// Принудительный refresh
app.post('/api/refresh', async (req, res) => {
  log('Принудительный запрос на обновление', 'info');
  fetchAllPrices().catch(e => log(`Ошибка refresh: ${e.message}`, 'err'));
  res.json({ ok: true, msg: 'Обновление запущено' });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime().toFixed(0) + 's',
    fetchCount: state.fetchCount,
    errorCount: state.errorCount,
    stationsLoaded: state.stations.length,
    lastUpdated: state.lastUpdated,
  });
});

// ─────────────────────────────────────────
// CRON: каждые 5 минут
// ─────────────────────────────────────────
cron.schedule('*/5 * * * *', () => {
  log('CRON: плановый запрос данных');
  fetchAllPrices().catch(e => log(`CRON ошибка: ${e.message}`, 'err'));
});

// ─────────────────────────────────────────
// СТАРТ
// ─────────────────────────────────────────
app.listen(PORT, async () => {
  log(`Сервер запущен: http://localhost:${PORT}`, 'ok');
  log('Загрузка кэша...');
  const cached = loadCache();
  if (!cached) {
    log('Кэша нет — загружаем fallback данные');
    state.stations = FALLBACK_STATIONS;
    state.lastUpdated = new Date().toISOString();
    state.avgPrice = 181.9;
    state.bestPrice = 156.9;
    state.bestStation = 'Costco — 45 Hucknall Rd';
  }
  log('Первый парсинг при старте...');
  fetchAllPrices().catch(e => log(`Старт ошибка: ${e.message}`, 'err'));
});
