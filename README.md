# GTA Gas Prices — Backend Парсер

Автоматический парсер цен на бензин по всему GTA.
Обновляет данные каждые 5 минут, сохраняет кэш на диск.

## Структура

```
gas-scraper/
├── server.js          ← главный сервер + парсер
├── package.json
├── data/
│   └── prices_cache.json   ← кэш (создаётся автоматически)
└── public/
    └── index.html     ← live дашборд
```

## Запуск

```bash
# 1. Установить зависимости (один раз)
npm install

# 2. Запустить сервер
node server.js
```

Затем открыть в браузере: **http://localhost:3000**

## API Endpoints

| Endpoint | Описание |
|---|---|
| `GET /api/prices` | Все заправки с ценами и мета-данными |
| `GET /api/prices?area=toronto` | Фильтр по району |
| `GET /api/prices?fuel=premium` | Фильтр по типу топлива |
| `GET /api/prices?sort=dist` | Сортировка по расстоянию |
| `GET /api/meta` | Только мета (лёгкий polling) |
| `GET /api/logs` | Лог парсера (последние 50) |
| `POST /api/refresh` | Принудительное обновление |
| `GET /api/health` | Статус сервера |

### Пример ответа /api/prices

```json
{
  "ok": true,
  "meta": {
    "lastUpdated": "2026-04-01T08:31:04.000Z",
    "lastSource": "gasbuddy",
    "avgPrice": 181.9,
    "bestPrice": 156.9,
    "bestStation": "Costco — 45 Hucknall Rd",
    "forecast": { "tomorrow": 165.9, "change": -16.0, "source": "En-Pro" },
    "trend": { "dates": [...], "values": [...] }
  },
  "count": 20,
  "stations": [
    {
      "id": 1,
      "brand": "Costco",
      "address": "45 Hucknall Rd",
      "city": "North York",
      "area": "toronto",
      "lat": 43.7677,
      "lng": -79.4089,
      "regular": 156.9,
      "midgrade": 160.4,
      "premium": 170.9,
      "diesel": 162.9,
      "source": "gasbuddy",
      "updatedAt": "2026-04-01T08:31:04.000Z"
    }
    ...
  ]
}
```

## Источники парсинга

| Источник | URL | Статус |
|---|---|---|
| GasBuddy | gasbuddy.com/gasprices/ontario/toronto | Основной (может блокировать) |
| CAA | caa.ca/gas-prices | Резервный |
| Ontario Gov | ontario.ca/motor-fuel-prices | Средние по городам |
| Stockr | stockr.net/toronto/gasprice.aspx | Прогноз цен |

> **Примечание:** GasBuddy периодически блокирует парсеры.
> При блокировке сервер автоматически переключается на кэш + небольшую вариацию.
> Для production рекомендуется использовать прокси (Bright Data, ScrapingBee).

## Параметры запроса /api/prices

```
?area=toronto|mississauga|brampton|scarborough|all
?fuel=regular|midgrade|premium|diesel
?sort=regular|premium|dist|brand
?limit=10
```

## Расписание (CRON)

```
*/5 * * * *  ← каждые 5 минут
```

Изменить в server.js строка: `cron.schedule('*/5 * * * *', ...)`

## Production деплой (PM2)

```bash
npm install -g pm2
pm2 start server.js --name gas-scraper
pm2 save
pm2 startup
```

## Переменные окружения (опционально)

```bash
PORT=3000                    # порт сервера (default: 3000)
SCRAPING_BEE_KEY=xxx        # API ключ для обхода блокировок
PROXY_URL=http://user:pass@proxy:port
```
