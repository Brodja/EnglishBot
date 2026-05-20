import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;

  try {
    await app.listen(port);
    console.log(`🚀 English Bot is running on port ${port}`);
    console.log(`🗄️  DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Встановлений' : '❌ Відсутній'}`);
    console.log(`🤖 Telegram Bot Token: ${process.env.API_KEY ? '✅ Встановлений' : '❌ Відсутній'}`);
    console.log(`📋 Google Sheets API Key: ${process.env.GOOGLE_SHEETS_API_KEY ? '✅ Встановлений' : '❌ Відсутній'}`);
  } catch (error) {
    console.error('❌ Помилка запуску:', error);
    process.exit(1);
  }
}

bootstrap();
