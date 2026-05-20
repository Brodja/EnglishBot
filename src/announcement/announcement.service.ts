import { Injectable, Logger } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { CHANGELOG, ChangelogEntry } from '../telegram/changelog';

export interface BroadcastResult {
  recipients: number;
  failures: number;
}

const RATE_LIMIT_MS = 35; // ~28 msg/s, безпечно під telegram-лімітом 30/s

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Усі announce-записи, які ще не були розіслані.
   * Порядок — як у CHANGELOG (новіші вгорі).
   */
  async findAllPending(): Promise<ChangelogEntry[]> {
    const announceable = CHANGELOG.filter((e) => e.announce);
    if (announceable.length === 0) return [];

    const sentIds = new Set(
      (
        await this.prisma.announcement.findMany({
          where: { changelogId: { in: announceable.map((e) => e.id) } },
          select: { changelogId: true },
        })
      ).map((a) => a.changelogId),
    );

    return announceable.filter((e) => !sentIds.has(e.id));
  }

  /**
   * Розсилає текст усім юзерам. Юзери з заблокованим ботом ловляться у failures.
   * Зберігає записи у Announcement для всіх entries (idempotent).
   */
  async broadcast(
    entries: ChangelogEntry[],
    text: string,
    bot: Telegraf,
    sentBy: bigint,
  ): Promise<BroadcastResult> {
    if (entries.length === 0) {
      throw new Error('Немає записів для розсилки');
    }

    // Захист від конкурентного запуску
    const ids = entries.map((e) => e.id);
    const alreadySent = await this.prisma.announcement.findMany({
      where: { changelogId: { in: ids } },
      select: { changelogId: true },
    });
    if (alreadySent.length > 0) {
      throw new Error(
        `Анонси вже частково розіслані: ${alreadySent.map((a) => a.changelogId).join(', ')}`,
      );
    }

    const users = await this.prisma.user.findMany({ select: { telegramId: true } });
    let recipients = 0;
    let failures = 0;

    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.telegramId.toString(), text);
        recipients++;
      } catch (err) {
        failures++;
        this.logger.warn(
          `Не вдалося надіслати юзеру ${u.telegramId}: ${(err as Error).message}`,
        );
      }
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    // Маркуємо ВСІ entries як розіслані (одна розсилка = один пакет)
    await this.prisma.announcement.createMany({
      data: entries.map((e) => ({
        changelogId: e.id,
        sentBy,
        recipients,
        failures,
      })),
    });

    this.logger.log(
      `Розіслано пакет з ${entries.length} записів: ${recipients} success, ${failures} failures`,
    );
    return { recipients, failures };
  }
}
