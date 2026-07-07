import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, session } from 'telegraf';
import { Word } from '@prisma/client';
import { BotContext } from './interfaces/bot-context.interface';
import { UserService } from '../user/user.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { WordsService, LearningMode } from './services/words.service';
import { SyncService, SyncResult } from './services/sync.service';
import { FeedbackService, FeedbackRateLimitError } from '../feedback/feedback.service';
import { AnnouncementService } from '../announcement/announcement.service';
import {
  mainMenuKeyboard,
  learningMenuKeyboard,
  learnedWordsKeyboard,
  reviewMenuKeyboard,
} from './keyboards/main-menu.keyboard';
import {
  HELP_TEXT,
  getChangelogPage,
  formatAnnouncementChunks,
} from './changelog';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: Telegraf<BotContext>;

  private escapeMarkdownV2(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  private readonly adminIds: ReadonlySet<string>;

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly wordsService: WordsService,
    private readonly syncService: SyncService,
    private readonly feedbackService: FeedbackService,
    private readonly announcementService: AnnouncementService,
  ) {
    const token = this.configService.get<string>('telegram.apiKey');
    if (!token) {
      throw new Error('Telegram API key is not provided');
    }
    this.adminIds = new Set(this.configService.get<string[]>('admin.telegramIds') ?? []);
    this.bot = new Telegraf<BotContext>(token);
    this.bot.use(session());
    this.setupBotHandlers();
  }

  private isAdmin(telegramId: bigint): boolean {
    return this.adminIds.has(telegramId.toString());
  }

  private mainMenu(ctx: BotContext) {
    return mainMenuKeyboard(this.isAdmin(BigInt(ctx.from.id)));
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
        this.mainMenu(ctx),
      );
    });

    this.bot.hears('📚 Навчання', async (ctx) => {
      const user = await this.userService.findByTelegramId(BigInt(ctx.from.id));
      if (!user?.googleSheetsUrl) {
        await ctx.reply(
          '❌ Спочатку додайте посилання на Google Sheets!',
          this.mainMenu(ctx),
        );
        return;
      }

      const stats = await this.wordsService.getStats(BigInt(ctx.from.id));
      if (stats.total === 0) {
        await ctx.reply(
          '❌ У вашому словнику ще немає слів.\n\nНатисніть "🔄 Синхронізувати" щоб завантажити їх з таблиці.',
          this.mainMenu(ctx),
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

    this.bot.hears('🔗 Моя таблиця', async (ctx) => {
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
          this.mainMenu(ctx),
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

    this.bot.hears('🇺🇸 Англійське', (ctx) => this.handleGetWord(ctx, 'en'));
    this.bot.hears('🇺🇦 Український', (ctx) => this.handleGetWord(ctx, 'uk'));

    this.bot.hears('🔁 Повторення', async (ctx) => {
      const stats = await this.wordsService.getReviewStats(BigInt(ctx.from.id));
      if (stats.learnedEn === 0 && stats.learnedUk === 0) {
        await ctx.reply(
          '❌ У вас ще немає вивчених слів. Спочатку повчи їх у меню навчання.',
          this.mainMenu(ctx),
        );
        return;
      }
      await ctx.reply(
        `🔁 Меню повторення\n\n` +
          `🇺🇸 Вивчених: ${stats.learnedEn} (залишилось у колі: ${stats.remainingEn})\n` +
          `🇺🇦 Вивчених: ${stats.learnedUk} (залишилось у колі: ${stats.remainingUk})\n\n` +
          `💡 Слова випадають випадково. Коли пройдеш усі — коло почнеться заново.`,
        reviewMenuKeyboard(),
      );
    });

    this.bot.hears('🔁🇺🇸 Англійське', (ctx) => this.handleReviewWord(ctx, 'en'));
    this.bot.hears('🔁🇺🇦 Український', (ctx) => this.handleReviewWord(ctx, 'uk'));

    this.bot.hears('📚 Вивчені', async (ctx) => {
      const learned = await this.wordsService.getLearnedWords(
        BigInt(ctx.from.id),
      );
      await ctx.reply(
        `📚 Керування вивченими словами\n\nУ вас ${learned.length} вивчених слів`,
        learnedWordsKeyboard(),
      );
    });

    this.bot.hears('📋 Усі вивчені', async (ctx) => {
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

    this.bot.hears('🗑️ Видалити', async (ctx) => {
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

    this.bot.hears('⬅️ До навчання', async (ctx) => {
      const stats = await this.wordsService.getStats(BigInt(ctx.from.id));
      await ctx.reply(
        `📖 Меню навчання\n\n` +
          `📊 Слів: ${stats.total}\n` +
          `✅ Вивчено 🇺🇸→🇺🇦: ${stats.learnedEn} | 🇺🇦→🇺🇸: ${stats.learnedUk}`,
        learningMenuKeyboard(),
      );
    });

    this.bot.hears('⬅️ Назад', async (ctx) => {
      await ctx.reply('Головне меню:', this.mainMenu(ctx));
    });

    this.bot.hears('ℹ️ Допомога', async (ctx) => {
      await ctx.reply(HELP_TEXT, this.mainMenu(ctx));
    });

    this.bot.hears('📝 Оновлення', async (ctx) => {
      const page = getChangelogPage(0);
      await ctx.reply(page.text, {
        reply_markup: { inline_keyboard: this.buildChangelogNav(page) },
      });
    });

    this.bot.hears('📬 Зворотний зв\'язок', async (ctx) => {
      await ctx.reply(
        '📨 Напишіть ваше повідомлення (баг чи побажання).\n\n' +
          'Воно піде розробнику. Обмеження — 1 повідомлення на годину.',
      );
      ctx.session = { awaitingFeedback: true };
    });

    this.bot.hears('📥 Повідомлення', async (ctx) => {
      if (!this.isAdmin(BigInt(ctx.from.id))) {
        await ctx.reply('❌ Це адмін-функція.', this.mainMenu(ctx));
        return;
      }
      await ctx.reply(await this.formatFeedbackList(), this.mainMenu(ctx));
    });

    this.bot.hears('📢 Анонсувати', async (ctx) => {
      if (!this.isAdmin(BigInt(ctx.from.id))) {
        await ctx.reply('❌ Це адмін-функція.', this.mainMenu(ctx));
        return;
      }
      const entries = await this.announcementService.findAllPending();
      if (entries.length === 0) {
        await ctx.reply(
          '✅ Усі анонси вже розіслано. Додай новий запис з `announce: true` у changelog.ts.',
          this.mainMenu(ctx),
        );
        return;
      }
      const userCount = await this.userService.countAll();
      const chunks = formatAnnouncementChunks(entries);
      const restCount = chunks.length - 1;
      const restLabel = restCount === 1 ? 'чанк' : 'чанки';
      const preview =
        restCount > 0 ? `${chunks[0]}\n\n... (ще ${restCount} ${restLabel})` : chunks[0];

      await ctx.reply(
        `📢 Готовий анонс для розсилки\n\n` +
          `📦 Записів: ${entries.length}\n` +
          `📨 Чанків на юзера: ${chunks.length}\n` +
          `👥 Юзерів: ${userCount}\n\n` +
          `Превʼю першого чанку:\n──────────────\n${preview}\n──────────────`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Розіслати', callback_data: 'announce_confirm' }],
              [{ text: '❌ Скасувати', callback_data: 'announce_cancel' }],
            ],
          },
        },
      );
    });

    this.bot.on('text', async (ctx) => {
      if (ctx.session?.awaitingFeedback) {
        await this.handleFeedbackText(ctx, ctx.message.text.trim());
        return;
      }

      if (!ctx.session?.awaitingSheetUrl) {
        await ctx.reply(
          'Використовуйте кнопки меню для навігації 👇',
          this.mainMenu(ctx),
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
        await ctx.reply('Можна переходити до навчання!', this.mainMenu(ctx));
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

      if (data.startsWith('chlog_')) {
        const offset = Number.parseInt(data.slice('chlog_'.length), 10) || 0;
        const page = getChangelogPage(offset);
        try {
          await ctx.editMessageText(page.text, {
            reply_markup: { inline_keyboard: this.buildChangelogNav(page) },
          });
        } catch {
          /* same content — ігноруємо */
        }
        await ctx.answerCbQuery();
        return;
      }

      if (data.startsWith('announce_')) {
        if (!this.isAdmin(BigInt(ctx.from.id))) {
          await ctx.answerCbQuery('❌ Тільки для адмінів');
          return;
        }
        if (data === 'announce_cancel') {
          await ctx.editMessageText('❌ Розсилку скасовано.');
          await ctx.answerCbQuery();
          return;
        }
        if (data === 'announce_confirm') {
          await ctx.answerCbQuery('⏳ Починаю розсилку...');
          await this.handleBroadcast(ctx);
        }
        return;
      }

      if (data.startsWith('reviewed_')) {
        // format: reviewed_<wordId>_<mode>
        const rest = data.slice('reviewed_'.length);
        const lastSep = rest.lastIndexOf('_');
        const wordId = rest.slice(0, lastSep);
        const mode = rest.slice(lastSep + 1) as LearningMode;
        try {
          await this.wordsService.markReviewed(wordId, mode);
          await ctx.editMessageReplyMarkup({
            inline_keyboard: [[{ text: '✅ Повторив +1', callback_data: 'noop' }]],
          });
          await ctx.answerCbQuery('✅ +1 до лічильника повторень');
        } catch {
          await ctx.answerCbQuery('❌ Слово вже не існує');
        }
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

  private async handleReviewWord(ctx: BotContext, mode: LearningMode) {
    try {
      const { word, cycleReset } = await this.wordsService.getReviewWord(
        BigInt(ctx.from.id),
        mode,
      );
      const front = mode === 'en' ? word.english : word.translation;
      const back = mode === 'en' ? word.translation : word.english;
      const frontFlag = mode === 'en' ? '🇺🇸' : '🇺🇦';
      const backFlag = mode === 'en' ? '🇺🇦' : '🇺🇸';

      const header = cycleReset
        ? '🎉 Ти повторив усі слова у цьому напрямку\\! Починаємо нове коло\\.\n\n'
        : '';

      await ctx.reply(
        header +
          `${frontFlag} *${this.escapeMarkdownV2(front)}*\n\n` +
          `${backFlag} ||${this.escapeMarkdownV2(back)}||`,
        {
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Повторив', callback_data: `reviewed_${word.id}_${mode}` }],
            ],
          },
        },
      );
    } catch (error) {
      await ctx.reply(`❌ ${error.message}`, reviewMenuKeyboard());
    }
  }

  private async handleGetWord(ctx: BotContext, mode: LearningMode) {
    try {
      const { word, cycleReset } = await this.wordsService.getRandomWord(
        BigInt(ctx.from.id),
        mode,
      );
      const front = mode === 'en' ? word.english : word.translation;
      const back = mode === 'en' ? word.translation : word.english;
      const frontFlag = mode === 'en' ? '🇺🇸' : '🇺🇦';
      const backFlag = mode === 'en' ? '🇺🇦' : '🇺🇸';

      const header = cycleReset
        ? '🎉 Ти пройшов усі слова у цьому напрямку\\! Пул скинуто, починаємо нове коло\\.\n\n'
        : '';

      await ctx.reply(
        header +
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

  private async handleFeedbackText(ctx: BotContext, text: string) {
    const userId = BigInt(ctx.from.id);

    if (!text) {
      await ctx.reply('❌ Порожнє повідомлення. Спробуйте ще раз.');
      return;
    }

    try {
      await this.feedbackService.create(userId, text);

      await ctx.reply(
        '✅ Дякую! Повідомлення надіслано розробнику.',
        this.mainMenu(ctx),
      );

      // Пересилаємо адмінам
      const u = ctx.from;
      const name = u.first_name + (u.last_name ? ` ${u.last_name}` : '');
      const handle = u.username ? `@${u.username}` : '—';
      const adminMsg =
        `📨 Нове повідомлення\n\n` +
        `👤 ${name} (${handle})\n` +
        `🆔 ${u.id}\n\n` +
        `──────────────\n${text}\n──────────────`;

      for (const adminId of this.adminIds) {
        try {
          await this.bot.telegram.sendMessage(adminId, adminMsg);
        } catch (err) {
          this.logger.error(`Не вдалось переслати feedback адміну ${adminId}:`, err);
        }
      }
    } catch (err) {
      if (err instanceof FeedbackRateLimitError) {
        await ctx.reply(
          `⏳ Зачекайте ще ${err.waitMinutes} хв перед наступним повідомленням.`,
          this.mainMenu(ctx),
        );
      } else {
        this.logger.error('Feedback save error:', err);
        await ctx.reply('❌ Не вдалося зберегти. Спробуйте пізніше.', this.mainMenu(ctx));
      }
    }

    ctx.session = {};
  }

  private buildChangelogNav(page: { offset: number; pageSize: number; hasPrev: boolean; hasMore: boolean }) {
    const row: { text: string; callback_data: string }[] = [];
    if (page.hasPrev) {
      row.push({
        text: '⬅️ Новіші',
        callback_data: `chlog_${Math.max(0, page.offset - page.pageSize)}`,
      });
    }
    if (page.hasMore) {
      row.push({
        text: '📜 Старіші',
        callback_data: `chlog_${page.offset + page.pageSize}`,
      });
    }
    return row.length > 0 ? [row] : [];
  }

  private async handleBroadcast(ctx: BotContext) {
    const entries = await this.announcementService.findAllPending();
    if (entries.length === 0) {
      await ctx.editMessageText('❌ Немає анонсів для розсилки (можливо вже розіслано).');
      return;
    }

    await ctx.editMessageText(`⏳ Розсилаю ${entries.length} записів...`);

    try {
      const result = await this.announcementService.broadcast(
        entries,
        this.bot,
        BigInt(ctx.from.id),
      );
      await ctx.reply(
        `✅ Розсилку завершено\n\n` +
          `📦 Записів: ${entries.length}\n` +
          `📨 Чанків на юзера: ${result.chunks}\n` +
          `📤 Доставлено: ${result.recipients}\n` +
          `❌ Помилок: ${result.failures}`,
        this.mainMenu(ctx),
      );
    } catch (err) {
      this.logger.error('Broadcast error:', err);
      await ctx.reply(`❌ Помилка: ${(err as Error).message}`, this.mainMenu(ctx));
    }
  }

  private async formatFeedbackList(): Promise<string> {
    const items = await this.feedbackService.listRecent(20);
    if (items.length === 0) return '📥 Поки що немає повідомлень.';

    const lines = items.map((f, i) => {
      const d = f.createdAt;
      const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const u = f.user;
      const name = u.firstName || 'без імені';
      const handle = u.username ? `@${u.username}` : `id:${u.telegramId}`;
      const truncated = f.text.length > 300 ? f.text.slice(0, 300) + '…' : f.text;
      return `${i + 1}. ${date} — ${name} (${handle})\n${truncated}`;
    });

    return `📥 Останні ${items.length} повідомлень:\n\n${lines.join('\n\n')}`;
  }
}
