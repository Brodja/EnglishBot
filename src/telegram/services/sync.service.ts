import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../../google-sheets/google-sheets.service';
import { UserService } from '../../user/user.service';

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly userService: UserService,
  ) {}

  /**
   * Синхронізує слова з Google Sheets у БД.
   *  - INSERT: слова, яких ще нема в БД
   *  - UPDATE: переклад змінився
   *  - DELETE: слово зникло з таблиці (або має маркер "вивчено" в колонці F — фільтр у GoogleSheetsService)
   * Прогрес (passedEn/passedUk/learned) збережених слів НЕ скидається.
   */
  async syncWords(telegramId: bigint): Promise<SyncResult> {
    const user = await this.userService.findByTelegramId(telegramId);
    if (!user?.googleSheetsUrl) {
      throw new Error('Спочатку додайте посилання на Google Sheets.');
    }

    this.logger.log(`Sync words for user ${telegramId}`);

    const sheetRows = await this.googleSheetsService.extractWordsFromSheet(
      user.googleSheetsUrl,
    );

    // Нормалізуємо: lowercase + trim. english виступає унікальним ключем у межах юзера.
    const sheetMap = new Map<string, { english: string; translation: string }>();
    for (const row of sheetRows) {
      const key = row.english.toLowerCase().trim();
      if (!key) continue;
      sheetMap.set(key, { english: key, translation: row.translation });
    }

    const existing = await this.prisma.word.findMany({
      where: { userId: telegramId },
      select: { id: true, english: true, translation: true },
    });
    const existingMap = new Map(existing.map((w) => [w.english, w]));

    const toCreate: { english: string; translation: string }[] = [];
    const toUpdate: { id: string; translation: string }[] = [];
    const toDelete: string[] = [];

    for (const [key, sw] of sheetMap) {
      const ex = existingMap.get(key);
      if (!ex) {
        toCreate.push(sw);
      } else if (ex.translation !== sw.translation) {
        toUpdate.push({ id: ex.id, translation: sw.translation });
      }
    }
    for (const [key, ex] of existingMap) {
      if (!sheetMap.has(key)) toDelete.push(ex.id);
    }

    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        await tx.word.createMany({
          data: toCreate.map((w) => ({
            userId: telegramId,
            english: w.english,
            translation: w.translation,
          })),
        });
      }
      for (const u of toUpdate) {
        await tx.word.update({
          where: { id: u.id },
          data: { translation: u.translation },
        });
      }
      if (toDelete.length) {
        await tx.word.deleteMany({ where: { id: { in: toDelete } } });
      }
      await tx.user.update({
        where: { telegramId },
        data: { lastSyncAt: new Date() },
      });
    });

    const result: SyncResult = {
      added: toCreate.length,
      updated: toUpdate.length,
      removed: toDelete.length,
      total: sheetMap.size,
    };

    this.logger.log(
      `Sync done for ${telegramId}: +${result.added} ~${result.updated} -${result.removed}, total ${result.total}`,
    );

    return result;
  }
}
