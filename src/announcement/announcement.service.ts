import { Injectable, Logger } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { CHANGELOG, ChangelogEntry, formatAnnouncementChunks } from '../telegram/changelog';

export interface BroadcastResult {
  recipients: number;
  failures: number;
  chunks: number;
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
   * Розбиває entries на чанки <=3800 символів і шле всі чанки кожному юзеру по черзі.
   * Маркує всі entries як відправлені атомарно після завершення.
   */
  async broadcast(
    entries: ChangelogEntry[],
    bot: Telegraf,
    sentBy: bigint,
  ): Promise<BroadcastResult> {
    if (entries.length === 0) {
      throw new Error('Немає записів для розсилки');
    }

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

    const chunks = formatAnnouncementChunks(entries);
    const users = await this.prisma.user.findMany({ select: { telegramId: true } });
    let recipients = 0;
    let failures = 0;

    for (const u of users) {
      let userOk = true;
      for (const chunk of chunks) {
        try {
          await bot.telegram.sendMessage(u.telegramId.toString(), chunk);
        } catch (err) {
          userOk = false;
          this.logger.warn(
            `Не вдалося надіслати юзеру ${u.telegramId}: ${(err as Error).message}`,
          );
          break;
        }
        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      }
      if (userOk) recipients++;
      else failures++;
    }

    await this.prisma.announcement.createMany({
      data: entries.map((e) => ({
        changelogId: e.id,
        sentBy,
        recipients,
        failures,
      })),
    });

    this.logger.log(
      `Розіслано ${entries.length} entries у ${chunks.length} чанках: ${recipients} success, ${failures} failures`,
    );
    return { recipients, failures, chunks: chunks.length };
  }
}
