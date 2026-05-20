# English Learning Telegram Bot

Telegram бот для вивчення англійських слів з Google Sheets. NestJS + Telegraf + PostgreSQL (Prisma).

## Як це працює

1. Юзер додає посилання на свою Google Sheets таблицю.
2. Натискає **"🔄 Синхронізувати"** — бот витягує слова з таблиці і зберігає у Postgres (diff: додає нові, оновлює змінені переклади, видаляє ті що зникли).
3. У режимі навчання бот рандомно видає:
   - 🇺🇸 англійське слово (переклад прихований через MarkdownV2 spoiler)
   - 🇺🇦 переклад (англійське слово приховане)
4. Кожне показане слово помічається `passedEn` або `passedUk` — щоб не повторювати в межах поточного циклу.
5. Коли всі не-вивчені слова в межах режиму пройдені — цикл скидається автоматично, починається нове коло.
6. Кнопка **"✅ Вивчено"** під словом ставить `learned=true` — таке слово більше не випадає у навчанні.

## Структура Google Sheets

| Колонка | Що там |
|---------|--------|
| B | Англійське слово (обов'язково) |
| C | Транскрипція (не використовується) |
| D | Переклад |
| E | Приклади (не використовується) |
| F | Маркер "вивчено" — будь-який текст. Такі рядки фільтруються при синхронізації. |

Таблиця має бути публічна (Share → Anyone with the link → Viewer).

## Запуск локально

### 1. Підняти PostgreSQL

```bash
docker compose -f docker/docker-compose.yml up -d
```

Це створює БД `englishbot` з юзером `englishbot/englishbot_pass` на `localhost:5432`. Дані зберігаються у volume `englishbot_pgdata`.

### 2. Налаштувати `.env`

```bash
cp env.example .env
```

Заповнити:
- `API_KEY` — токен від [@BotFather](https://t.me/BotFather)
- `GOOGLE_SHEETS_API_KEY` — ключ з [Google Cloud Console](https://console.cloud.google.com/) (див. [GOOGLE_SHEETS_SETUP.md](GOOGLE_SHEETS_SETUP.md))
- `DATABASE_URL` — для локалки залишається з шаблона

### 3. Встановити залежності і прокатити міграції

```bash
npm install
npx prisma migrate deploy
```

### 4. Запустити

```bash
npm run start:dev
```

## Запуск у продакшені

Що змінюється — тільки `DATABASE_URL` на робочий postgres та `npm run start:prod`. Решта так само.

## Корисні команди

```bash
npm run start:dev              # dev з ватчем
npm run build                  # tsc build у /dist
npm run start:prod             # node dist/main.js

npm run prisma:generate        # перегенерувати Prisma client
npm run prisma:migrate         # створити нову міграцію (dev)
npm run prisma:migrate:deploy  # прокатити міграції (prod)
npm run prisma:studio          # GUI на http://localhost:5555 для перегляду БД
```

## Структура

```
src/
├── main.ts                          # bootstrap
├── app.module.ts                    # PrismaModule + ConfigModule + ThrottlerModule + бізнес-модулі
├── config/configuration.ts          # порт, telegram.apiKey, googleSheets.apiKey
├── prisma/
│   ├── prisma.module.ts             # @Global модуль
│   └── prisma.service.ts            # PrismaClient через @prisma/adapter-pg
├── user/
│   ├── user.module.ts
│   └── user.service.ts              # findByTelegramId, upsertUser, setGoogleSheetsUrl
├── google-sheets/
│   ├── google-sheets.module.ts
│   └── google-sheets.service.ts     # тягне B:F, фільтрує по F-маркеру
└── telegram/
    ├── telegram.module.ts
    ├── telegram.service.ts          # всі бот-handlers
    ├── interfaces/bot-context.interface.ts
    ├── keyboards/main-menu.keyboard.ts
    └── services/
        ├── words.service.ts         # getRandomWord(mode), markLearned, getStats
        └── sync.service.ts          # syncWords: diff Sheet vs DB у транзакції

prisma/
├── schema.prisma                    # User + Word
└── migrations/                      # SQL міграції

docker/
├── docker-compose.yml               # postgres:16-alpine для dev
└── README.md
```

## Вимоги

- Node.js 18+
- PostgreSQL 14+
- Telegram Bot Token
- Google Sheets API Key
