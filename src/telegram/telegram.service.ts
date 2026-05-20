import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, session } from 'telegraf';
import { Word } from '@prisma/client';
import { BotContext } from './interfaces/bot-context.interface';
import { UserService } from '../user/user.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { WordsService, LearningMode } from './services/words.service';
import { SyncService, SyncResult } from './services/sync.service';
import {
  mainMenuKeyboard,
  learningMenuKeyboard,
  learnedWordsKeyboard,
} from './keyboards/main-menu.keyboard';
import { HELP_TEXT, formatChangelog } from './changelog';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: Telegraf<BotContext>;

  private escapeMarkdownV2(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly wordsService: WordsService,
    private readonly syncService: SyncService,
  ) {
    const token = this.configService.get<string>('telegram.apiKey');
    if (!token) {
      throw new Error('Telegram API key is not provided');
    }
    this.bot = new Telegraf<BotContext>(token);
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

  async onApplicationShutdown() {
    this.bot.stop();
    this.logger.log('Telegram bot stopped');
  }

  private setupBotHandlers() {
    this.bot.start(async (ctx) => {
      const u = ctx.from;
      if (!u) return;

      await this.userService.upsertUser({
        telegramId: BigInt(u.id),
        firstName: u.first_name,
        lastName: u.last_name,
        username: u.username,
      });

      await ctx.reply(
        `Привіт, ${u.first_name}! 👋\n\n` +
          `Я бот для вивчення англійських слів з Google Sheets.\n\n` +
          `Спочатку додайте посилання на вашу таблицю, потім натисніть "🔄 Синхронізувати" — і можна вчитися!`,
        mainMenuKeyboard(),
      );
    });

    this.bot.hears('📚 Перейти до навчання', async (ctx) => {
      const user = await this.userService.findByTelegramId(BigInt(ctx.from.id));
      if (!user?.googleSheetsUrl) {
        await ctx.reply(
          '❌ Спочатку додайте посилання на Google Sheets!',
          mainMenuKeyboard(),
        );
        return;
      }

      const stats = await this.wordsService.getStats(BigInt(ctx.from.id));
      if (stats.total === 0) {
        await ctx.reply(
          '❌ У вашому словнику ще немає слів.\n\nНатисніть "🔄 Синхронізувати" щоб завантажити їх з таблиці.',
          mainMenuKeyboard(),
        );
        return;
      }

      await ctx.reply(
        `📖 Меню навчання\n\n` +
          `📊 Слів: ${stats.total}\n` +
          `✅ Вивчено 🇺🇸→🇺🇦: ${stats.learnedEn} | 🇺🇦→🇺🇸: ${stats.learnedUk}\n` +
          `🔁 Цикл 🇺🇸: ${stats.passedInCurrentEnCycle} / ${stats.notLearnedEn}\n` +
          `🔁 Цикл 🇺🇦: ${stats.passedInCurrentUkCycle} / ${stats.notLearnedUk}\n\n` +
          `💡 Натисніть на заблюрений текст, щоб його розкрити!`,
        learningMenuKeyboard(),
      );
    });

    this.bot.hears('🔗 Додати посилання', async (ctx) => {
      const user = await this.userService.findByTelegramId(BigInt(ctx.from.id));

      if (user?.googleSheetsUrl) {
        await ctx.reply(
          `📋 Ваше поточне посилання:\n${user.googleSheetsUrl}\n\n` +
            `Надішліть нове посилання на Google Sheets для оновлення:`,
        );
      } else {
        await ctx.reply(
          `📋 Надішліть посилання на вашу Google Sheets таблицю.\n\n` +
            `Переконайтеся що:\n` +
            `• Таблиця доступна для перегляду\n` +
            `• Англійські слова в колонці B\n` +
            `• Переклади в колонці D\n` +
            `• Колонка F — маркер вивчених слів (якщо є текст — слово ігнорується)`,
        );
      }

      ctx.session = { awaitingSheetUrl: true };
    });

    this.bot.hears('🔄 Синхронізувати', async (ctx) => {
      const user = await this.userService.findByTelegramId(BigInt(ctx.from.id));
      if (!user?.googleSheetsUrl) {
        await ctx.reply(
          '❌ Спочатку додайте посилання на Google Sheets!',
          mainMenuKeyboard(),
        );
        return;
      }

      const status = await ctx.reply('🔄 Синхронізую словник...');
      try {
        const result = await this.syncService.syncWords(BigInt(ctx.from.id));
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          status.message_id,
          undefined,
          this.formatSyncResult(result),
        );
      } catch (error) {
        this.logger.error('Sync error:', error);
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          status.message_id,
          undefined,
          `❌ Помилка синхронізації:\n${error.message}`,
        );
      }
    });

    this.bot.hears('🇺🇸 Отримати англійське слово', (ctx) =>
      this.handleGetWord(ctx, 'en'),
    );
    this.bot.hears('🇺🇦 Отримати переклад', (ctx) =>
      this.handleGetWord(ctx, 'uk'),
    );

    this.bot.hears('📚 Керувати вивченими словами', async (ctx) => {
      const learned = await this.wordsService.getLearnedWords(
        BigInt(ctx.from.id),
      );
      await ctx.reply(
        `📚 Керування вивченими словами\n\nУ вас ${learned.length} вивчених слів`,
        learnedWordsKeyboard(),
      );
    });

    this.bot.hears('📋 Показати вивчені слова', async (ctx) => {
      const learned = await this.wordsService.getLearnedWords(
        BigInt(ctx.from.id),
      );
      if (learned.length === 0) {
        await ctx.reply('📋 У вас немає вивчених слів', learnedWordsKeyboard());
        return;
      }
      const text = learned
        .map((w, i) => `${i + 1}. ${this.learnedLabel(w)} — ${w.translation}`)
        .join('\n');
      await ctx.reply(
        `📋 Ваші вивчені слова (${learned.length}):\n` +
          `🇺🇸 = тільки EN→UK, 🇺🇦 = тільки UK→EN, 🇺🇸🇺🇦 = обидва напрямки\n\n${text}`,
        learnedWordsKeyboard(),
      );
    });

    this.bot.hears('🗑️ Видалити вивчені слова', async (ctx) => {
      const learned = await this.wordsService.getLearnedWords(
        BigInt(ctx.from.id),
      );
      if (learned.length === 0) {
        await ctx.reply(
          '📋 У вас немає вивчених слів для видалення',
          learnedWordsKeyboard(),
        );
        return;
      }
      await ctx.reply('🗑️ Виберіть слова для видалення:', {
        reply_markup: { inline_keyboard: this.buildLearnedRemoveKeyboard(learned) },
      });
    });

    this.bot.hears('⬅️ Назад до навчання', async (ctx) => {
      const stats = await this.wordsService.getStats(BigInt(ctx.from.id));
      await ctx.reply(
        `📖 Меню навчання\n\n` +
          `📊 Слів: ${stats.total}\n` +
          `✅ Вивчено 🇺🇸→🇺🇦: ${stats.learnedEn} | 🇺🇦→🇺🇸: ${stats.learnedUk}`,
        learningMenuKeyboard(),
      );
    });

    this.bot.hears('⬅️ Назад', async (ctx) => {
      await ctx.reply('Головне меню:', mainMenuKeyboard());
    });

    this.bot.hears('ℹ️ Допомога', async (ctx) => {
      await ctx.reply(HELP_TEXT, mainMenuKeyboard());
    });

    this.bot.hears('📝 Оновлення', async (ctx) => {
      await ctx.reply(formatChangelog(), mainMenuKeyboard());
    });

    this.bot.on('text', async (ctx) => {
      if (!ctx.session?.awaitingSheetUrl) {
        await ctx.reply(
          'Використовуйте кнопки меню для навігації 👇',
          mainMenuKeyboard(),
        );
        return;
      }

      const url = ctx.message.text.trim();
      if (!this.googleSheetsService.isValidGoogleSheetsUrl(url)) {
        await ctx.reply(
          '❌ Невірний формат посилання. Надішліть правильне посилання на Google Sheets.',
        );
        return;
      }

      try {
        // Зберігаємо URL і одразу синхронізуємо
        await this.userService.setGoogleSheetsUrl(BigInt(ctx.from.id), url);
        const status = await ctx.reply('🔄 Завантажую слова з таблиці...');

        const result = await this.syncService.syncWords(BigInt(ctx.from.id));

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          status.message_id,
          undefined,
          `✅ Посилання збережено!\n\n` + this.formatSyncResult(result),
        );
        await ctx.reply('Можна переходити до навчання!', mainMenuKeyboard());
      } catch (error) {
        this.logger.error('Error processing sheet URL:', error);
        await ctx.reply(
          `❌ Не вдалося отримати дані з таблиці:\n${error.message}\n\n` +
            `Переконайтеся що таблиця публічна та містить слова в колонці B.`,
        );
      }
      ctx.session = {};
    });

    this.bot.on('callback_query', async (ctx) => {
      if (!('data' in ctx.callbackQuery)) return;
      const data = ctx.callbackQuery.data;

      if (data.startsWith('learned_')) {
        // format: learned_<wordId>_<mode>
        const rest = data.slice('learned_'.length);
        const lastSep = rest.lastIndexOf('_');
        const wordId = rest.slice(0, lastSep);
        const mode = rest.slice(lastSep + 1) as LearningMode;
        const dirLabel = mode === 'en' ? '🇺🇸→🇺🇦' : '🇺🇦→🇺🇸';
        try {
          await this.wordsService.markLearned(wordId, mode);
          await ctx.editMessageReplyMarkup({
            inline_keyboard: [
              [{ text: `✅ Вивчено (${dirLabel})`, callback_data: 'noop' }],
            ],
          });
          await ctx.answerCbQuery(`✅ Позначено вивченим у напрямку ${dirLabel}`);
        } catch {
          await ctx.answerCbQuery('❌ Слово вже не існує');
        }
        return;
      }

      if (data.startsWith('remove_')) {
        const wordId = data.slice('remove_'.length);
        try {
          await this.wordsService.unmarkLearned(wordId);
          await ctx.answerCbQuery('🗑️ Знято з вивчених');
        } catch {
          await ctx.answerCbQuery('❌ Слово вже не існує');
        }

        const learned = await this.wordsService.getLearnedWords(
          BigInt(ctx.from.id),
        );
        if (learned.length === 0) {
          await ctx.editMessageText('📋 Всі слова знято з вивчених!');
          return;
        }
        await ctx.editMessageReplyMarkup({
          inline_keyboard: this.buildLearnedRemoveKeyboard(learned),
        });
        return;
      }

      if (data === 'clear_all_learned') {
        const count = await this.wordsService.clearAllLearned(
          BigInt(ctx.from.id),
        );
        await ctx.editMessageText(`🗑️ Знято мітку "вивчено" з ${count} слів`);
        await ctx.answerCbQuery('✅ Готово');
        return;
      }

      if (data === 'back_to_learned_menu') {
        await ctx.deleteMessage();
        const learned = await this.wordsService.getLearnedWords(
          BigInt(ctx.from.id),
        );
        await ctx.reply(
          `📚 Керування вивченими словами\n\nУ вас ${learned.length} вивчених слів`,
          learnedWordsKeyboard(),
        );
        return;
      }

      if (data === 'noop') {
        await ctx.answerCbQuery();
      }
    });

    this.bot.catch((err, ctx) => {
      this.logger.error(`Bot error for ${ctx.updateType}:`, err);
      ctx.reply('Виникла помилка. Спробуйте ще раз.');
    });
  }

  private async handleGetWord(ctx: BotContext, mode: LearningMode) {
    try {
      const word = await this.wordsService.getRandomWord(
        BigInt(ctx.from.id),
        mode,
      );
      const front = mode === 'en' ? word.english : word.translation;
      const back = mode === 'en' ? word.translation : word.english;
      const frontFlag = mode === 'en' ? '🇺🇸' : '🇺🇦';
      const backFlag = mode === 'en' ? '🇺🇦' : '🇺🇸';

      await ctx.reply(
        `${frontFlag} *${this.escapeMarkdownV2(front)}*\n\n` +
          `${backFlag} ||${this.escapeMarkdownV2(back)}||`,
        {
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Вивчено', callback_data: `learned_${word.id}_${mode}` }],
            ],
          },
        },
      );
    } catch (error) {
      await ctx.reply(`❌ ${error.message}`, learningMenuKeyboard());
    }
  }

  private buildLearnedRemoveKeyboard(words: Word[]) {
    const keyboard: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < words.length; i += 2) {
      const row = [{ text: `❌ ${this.learnedLabel(words[i])}`, callback_data: `remove_${words[i].id}` }];
      if (words[i + 1]) {
        row.push({
          text: `❌ ${this.learnedLabel(words[i + 1])}`,
          callback_data: `remove_${words[i + 1].id}`,
        });
      }
      keyboard.push(row);
    }
    keyboard.push([{ text: '🗑️ Очистити все', callback_data: 'clear_all_learned' }]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_learned_menu' }]);
    return keyboard;
  }

  private learnedLabel(w: Word): string {
    let flags = '';
    if (w.learnedEn && w.learnedUk) flags = '🇺🇸🇺🇦';
    else if (w.learnedEn) flags = '🇺🇸';
    else flags = '🇺🇦';
    return `${flags} ${w.english}`;
  }

  private formatSyncResult(r: SyncResult): string {
    return (
      `✅ Синхронізація завершена\n\n` +
      `➕ Додано: ${r.added}\n` +
      `📝 Оновлено: ${r.updated}\n` +
      `➖ Видалено: ${r.removed}\n` +
      `📊 Всього в словнику: ${r.total}`
    );
  }
}
