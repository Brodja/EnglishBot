import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, session } from 'telegraf';
import { BotContext } from './interfaces/bot-context.interface';
import { UserService } from '../user/user.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { WordsService } from './services/words.service';
import { mainMenuKeyboard, learningMenuKeyboard, learnedWordsKeyboard } from './keyboards/main-menu.keyboard';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf<BotContext>;

  // Допоміжна функція для екранування спеціальних символів в MarkdownV2
  private escapeMarkdownV2(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly wordsService: WordsService,
  ) {
    const token = this.configService.get<string>('telegram.apiKey');
    if (!token) {
      throw new Error('Telegram API key is not provided');
    }
    this.bot = new Telegraf<BotContext>(token);
    
    // Додаємо middleware для сесій
    this.bot.use(session());
    
    this.setupBotHandlers();
  }

  async onModuleInit() {
    try {
      await this.bot.launch();
      this.logger.log('🤖 Telegram bot started successfully');
    } catch (error) {
      this.logger.error('Failed to start Telegram bot:', error);
    }
  }

  private setupBotHandlers() {
    // Команда /start
    this.bot.start(async (ctx) => {
      const user = ctx.from;
      if (!user) return;

      // Створюємо або знаходимо користувача
      let dbUser = await this.userService.findByTelegramId(user.id);
      if (!dbUser) {
        dbUser = await this.userService.createUser({
          telegramId: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
        });
      }

      await ctx.reply(
        `Привіт, ${user.first_name}! 👋\n\n` +
        `Я бот для вивчення англійських слів з Google Sheets.\n\n` +
        `Спочатку додайте посилання на вашу таблицю, а потім можете почати навчання!`,
        mainMenuKeyboard()
      );
    });

    // Обробка кнопок головного меню
    this.bot.hears('📚 Перейти до навчання', async (ctx) => {
      const user = await this.userService.findByTelegramId(ctx.from.id);
      this.logger.log(`Користувач ${ctx.from.id} хоче перейти до навчання. Користувач знайдений: ${!!user}, URL: ${user?.googleSheetsUrl || 'відсутній'}`);
      
      if (!user?.googleSheetsUrl) {
        await ctx.reply(
          '❌ Спочатку додайте посилання на Google Sheets таблицю!',
          mainMenuKeyboard()
        );
        return;
      }

      await ctx.reply(
        '📖 Меню навчання:\n\n' +
        '🇺🇸 Отримати англійське слово\n' +
        '🇺🇦 Отримати переклад\n\n' +
        '💡 Натисніть на заблюрений текст, щоб його розкрити!',
        learningMenuKeyboard()
      );
    });

    this.bot.hears('🔗 Додати посилання', async (ctx) => {
      const user = await this.userService.findByTelegramId(ctx.from.id);
      
      if (user?.googleSheetsUrl) {
        await ctx.reply(
          `📋 Ваше поточне посилання:\n${user.googleSheetsUrl}\n\n` +
          `Надішліть нове посилання на Google Sheets для оновлення:`
        );
      } else {
        await ctx.reply(
          `📋 Надішліть посилання на вашу Google Sheets таблицю.\n\n` +
          `Переконайтеся що:\n` +
          `• Таблиця доступна для перегляду\n` +
          `• Англійські слова знаходяться в колонці B\n` +
          `• Переклади знаходяться в колонці D\n` +
          `• Колонка F - маркер вивчених слів (якщо є текст - слово ігнорується)`
        );
      }
      
      ctx.session = { awaitingSheetUrl: true };
      this.logger.log(`Встановлено сесію для користувача ${ctx.from.id}: awaitingSheetUrl = true`);
    });

    // Обробка кнопок меню навчання
    this.bot.hears('🇺🇸 Отримати англійське слово', async (ctx) => {
      try {
        const result = await this.wordsService.getRandomEnglishWord(ctx.from.id);
        
        const inlineKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Вивчено', callback_data: `learned_${result.word}` }]
            ]
          }
        };
        
        await ctx.reply(
          `🇺🇸 *${this.escapeMarkdownV2(result.word)}*\n\n` +
          `🇺🇦 ||${this.escapeMarkdownV2(result.translation)}||`,
          { parse_mode: 'MarkdownV2', ...inlineKeyboard }
        );
      } catch (error) {
        await ctx.reply(
          `❌ Помилка: ${error.message}`,
          learningMenuKeyboard()
        );
      }
    });

    this.bot.hears('🇺🇦 Отримати переклад', async (ctx) => {
      try {
        const result = await this.wordsService.getRandomTranslation(ctx.from.id);
        
        const inlineKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Вивчено', callback_data: `learned_${result.word}` }]
            ]
          }
        };
        
        await ctx.reply(
          `🇺🇦 *${this.escapeMarkdownV2(result.translation)}*\n\n` +
          `🇺🇸 ||${this.escapeMarkdownV2(result.word)}||`,
          { parse_mode: 'MarkdownV2', ...inlineKeyboard }
        );
      } catch (error) {
        await ctx.reply(
          `❌ Помилка: ${error.message}`,
          learningMenuKeyboard()
        );
      }
    });

    this.bot.hears('📚 Керувати вивченими словами', async (ctx) => {
      const learnedWords = await this.userService.getLearnedWords(ctx.from.id);
      
      await ctx.reply(
        `📚 Керування вивченими словами\n\n` +
        `У вас ${learnedWords.length} вивчених слів`,
        learnedWordsKeyboard()
      );
    });

    this.bot.hears('📋 Показати вивчені слова', async (ctx) => {
      const learnedWords = await this.userService.getLearnedWords(ctx.from.id);
      
      if (learnedWords.length === 0) {
        await ctx.reply(
          '📋 У вас немає вивчених слів',
          learnedWordsKeyboard()
        );
        return;
      }

      const wordsText = learnedWords.map((word, index) => `${index + 1}. ${word}`).join('\n');
      
      await ctx.reply(
        `📋 Ваші вивчені слова (${learnedWords.length}):\n\n${wordsText}`,
        learnedWordsKeyboard()
      );
    });

    this.bot.hears('🗑️ Видалити вивчені слова', async (ctx) => {
      const learnedWords = await this.userService.getLearnedWords(ctx.from.id);
      
      if (learnedWords.length === 0) {
        await ctx.reply(
          '📋 У вас немає вивчених слів для видалення',
          learnedWordsKeyboard()
        );
        return;
      }

      // Створюємо inline клавіатуру зі словами для видалення
      const keyboard = [];
      for (let i = 0; i < learnedWords.length; i += 2) {
        const row = [];
        row.push({ text: `❌ ${learnedWords[i]}`, callback_data: `remove_${learnedWords[i]}` });
        if (learnedWords[i + 1]) {
          row.push({ text: `❌ ${learnedWords[i + 1]}`, callback_data: `remove_${learnedWords[i + 1]}` });
        }
        keyboard.push(row);
      }
      keyboard.push([{ text: '🗑️ Очистити все', callback_data: 'clear_all_learned' }]);
      keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_learned_menu' }]);

      await ctx.reply(
        '🗑️ Виберіть слова для видалення:',
        { reply_markup: { inline_keyboard: keyboard } }
      );
    });

    this.bot.hears('⬅️ Назад до навчання', async (ctx) => {
      await ctx.reply(
        '📖 Меню навчання:\n\n' +
        '🇺🇸 Отримати англійське слово\n' +
        '🇺🇦 Отримати переклад\n\n' +
        '💡 Натисніть на заблюрений текст, щоб його розкрити!',
        learningMenuKeyboard()
      );
    });

    this.bot.hears('⬅️ Назад', async (ctx) => {
      await ctx.reply(
        'Головне меню:',
        mainMenuKeyboard()
      );
    });

    // Обробка текстових повідомлень (посилання на Google Sheets)
    this.bot.on('text', async (ctx) => {
      this.logger.log(`Отримано текст від користувача ${ctx.from.id}. Сесія: ${JSON.stringify(ctx.session)}`);
      
      if (ctx.session?.awaitingSheetUrl) {
        const url = ctx.message.text.trim();
        this.logger.log(`Отримано URL: ${url}`);
        
        if (!this.googleSheetsService.isValidGoogleSheetsUrl(url)) {
          this.logger.warn(`Невалідний URL: ${url}`);
          await ctx.reply(
            '❌ Невірний формат посилання. Надішліть правильне посилання на Google Sheets.'
          );
          return;
        }
        
        this.logger.log(`URL валідний, спробуємо отримати дані...`);

        try {
          // Перевіряємо чи можемо отримати дані з таблиці
          const words = await this.googleSheetsService.extractWordsFromSheet(url);
          
          if (words.length === 0) {
            await ctx.reply(
              '⚠️ Таблиця порожня або дані не знайдено в колонці B.\n' +
              'Переконайтеся що англійські слова знаходяться в колонці B.'
            );
            return;
          }

          // Зберігаємо посилання та дані
          this.logger.log(`Зберігаємо посилання для користувача ${ctx.from.id}`);
          await this.userService.updateGoogleSheetsUrl(ctx.from.id, url);
          this.logger.log(`Зберігаємо ${words.length} слів для користувача ${ctx.from.id}`);
          await this.userService.updateCachedWords(ctx.from.id, words);

          await ctx.reply(
            `✅ Посилання успішно збережено!\n\n` +
            `📊 Знайдено ${words.length} пар слів для навчання.\n\n` +
            `Тепер ви можете перейти до навчання!`,
            mainMenuKeyboard()
          );

          ctx.session = {};
          this.logger.log(`Очищено сесію для користувача ${ctx.from.id}`);
        } catch (error) {
          this.logger.error('Error processing Google Sheets URL:', error);
          await ctx.reply(
            `❌ Не вдалося отримати дані з таблиці.\n\n` +
            `Переконайтеся що:\n` +
            `• Таблиця доступна для перегляду\n` +
            `• Посилання правильне\n` +
            `• В таблиці є англійські слова в колонці B\n` +
            `• Колонка F порожня для слів, які хочете вивчати`
          );
        }
      } else {
        await ctx.reply(
          'Використовуйте кнопки меню для навігації 👇',
          mainMenuKeyboard()
        );
      }
    });

    // Обробка inline кнопок
    this.bot.on('callback_query', async (ctx) => {
      if (!('data' in ctx.callbackQuery)) return;
      const data = ctx.callbackQuery.data;
      
      if (data.startsWith('learned_')) {
        // Додаємо слово до вивчених
        const word = data.replace('learned_', '');
        await this.userService.addLearnedWord(ctx.from.id, word);
        
        await ctx.editMessageReplyMarkup({
          inline_keyboard: [
            [{ text: '✅ Додано до вивчених!', callback_data: 'word_learned' }]
          ]
        });
        
        await ctx.answerCbQuery(`✅ Слово "${word}" додано до вивчених!`);
      } else if (data.startsWith('remove_')) {
        // Видаляємо слово з вивчених
        const word = data.replace('remove_', '');
        await this.userService.removeLearnedWord(ctx.from.id, word);
        await ctx.answerCbQuery(`🗑️ Слово "${word}" видалено з вивчених!`);
        
        // Оновлюємо список
        const learnedWords = await this.userService.getLearnedWords(ctx.from.id);
        if (learnedWords.length === 0) {
          await ctx.editMessageText('📋 Всі слова видалено!');
          return;
        }
        
        // Перебудовуємо клавіатуру
        const keyboard = [];
        for (let i = 0; i < learnedWords.length; i += 2) {
          const row = [];
          row.push({ text: `❌ ${learnedWords[i]}`, callback_data: `remove_${learnedWords[i]}` });
          if (learnedWords[i + 1]) {
            row.push({ text: `❌ ${learnedWords[i + 1]}`, callback_data: `remove_${learnedWords[i + 1]}` });
          }
          keyboard.push(row);
        }
        keyboard.push([{ text: '🗑️ Очистити все', callback_data: 'clear_all_learned' }]);
        keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_learned_menu' }]);

        await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard });
      } else if (data === 'clear_all_learned') {
        // Очищуємо всі вивчені слова
        const user = await this.userService.findByTelegramId(ctx.from.id);
        if (user) {
          user.learnedWords = [];
          await user.save();
        }
        
        await ctx.editMessageText('🗑️ Всі вивчені слова очищено!');
        await ctx.answerCbQuery('✅ Всі слова видалено!');
      } else if (data === 'back_to_learned_menu') {
        await ctx.deleteMessage();
        const learnedWords = await this.userService.getLearnedWords(ctx.from.id);
        
        await ctx.reply(
          `📚 Керування вивченими словами\n\n` +
          `У вас ${learnedWords.length} вивчених слів`,
          learnedWordsKeyboard()
        );
      } else if (data === 'word_learned') {
        await ctx.answerCbQuery('Слово вже додано!');
      }
    });

    // Обробка помилок
    this.bot.catch((err, ctx) => {
      this.logger.error(`Bot error for ${ctx.updateType}:`, err);
      ctx.reply('Виникла помилка. Спробуйте ще раз.');
    });
  }

  async onApplicationShutdown() {
    await this.bot.stop();
    this.logger.log('Telegram bot stopped');
  }
}
