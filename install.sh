#!/bin/bash

echo "🚀 Встановлення залежностей для English Telegram Bot..."

# Встановлення основних залежностей
npm install @nestjs/core@^10.0.0 @nestjs/common@^10.0.0 @nestjs/platform-express@^10.0.0

# Встановлення конфігурації та бази даних
npm install @nestjs/config@^3.0.0 @nestjs/mongoose@^10.0.0 mongoose@^7.5.0

# Встановлення Telegram бота
npm install telegraf@^4.15.6

# Встановлення інших залежностей
npm install @nestjs/throttler@^5.0.0 reflect-metadata@^0.1.13 rxjs@^7.8.1
npm install googleapis@^126.0.1 dotenv@^16.3.1
npm install class-validator@^0.14.0 class-transformer@^0.5.1

# Встановлення dev залежностей
npm install -D @nestjs/cli@^10.0.0 @nestjs/schematics@^10.0.0 @nestjs/testing@^10.0.0
npm install -D @types/express@^4.17.17 @types/jest@^29.5.2 @types/node@^20.3.1
npm install -D @types/supertest@^2.0.12 typescript@^5.1.3
npm install -D @typescript-eslint/eslint-plugin@^6.0.0 @typescript-eslint/parser@^6.0.0
npm install -D eslint@^8.42.0 eslint-config-prettier@^9.0.0 eslint-plugin-prettier@^5.0.0
npm install -D jest@^29.5.0 prettier@^3.0.0 ts-jest@^29.1.0
npm install -D ts-loader@^9.4.3 ts-node@^10.9.1 tsconfig-paths@^4.2.1
npm install -D source-map-support@^0.5.21 supertest@^6.3.3

echo "✅ Встановлення завершено!"
echo ""
echo "📝 Наступні кроки:"
echo "1. Створіть файл .env та додайте ваші змінні (див. env.example)"
echo "2. Запустіть MongoDB"
echo "3. Запустіть бота: npm run start:dev"
