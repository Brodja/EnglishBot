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
    console.log(`🎅 Secret Santa Bot is running on port ${port}`);
    console.log(`📊 MongoDB URI: ${process.env.MONGO_URI || 'mongodb://localhost:27017/secretsanta'}`);
    console.log(`🤖 Telegram Bot Token: ${process.env.API_KEY ? '✅ Встановлений' : '❌ Відсутній'}`);
  } catch (error) {
    console.error('❌ Помилка запуску:', error);
    process.exit(1);
  }
}

bootstrap();
