import { Injectable, Logger } from '@nestjs/common';
import { Word } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type LearningMode = 'en' | 'uk';

export interface WordStats {
  total: number;
  learned: number;
  passedInCurrentEnCycle: number;
  passedInCurrentUkCycle: number;
}

@Injectable()
export class WordsService {
  private readonly logger = new Logger(WordsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Випадкове слово з тих, що ще не пройдені в поточному циклі режиму.
   * Коли всі не-вивчені слова в цьому режимі позначені passed — скидаємо цикл і повторюємо вибірку.
   */
  async getRandomWord(telegramId: bigint, mode: LearningMode): Promise<Word> {
    const passedField = mode === 'en' ? 'passedEn' : 'passedUk';

    const availableWhere = {
      userId: telegramId,
      learned: false,
      [passedField]: false,
    };

    let count = await this.prisma.word.count({ where: availableWhere });

    if (count === 0) {
      const totalNonLearned = await this.prisma.word.count({
        where: { userId: telegramId, learned: false },
      });

      if (totalNonLearned === 0) {
        throw new Error(
          'Немає слів для навчання. Натисніть "🔄 Синхронізувати" або зніміть мітки "вивчено".',
        );
      }

      this.logger.log(`Скидаємо цикл ${mode} для user ${telegramId}`);
      await this.prisma.word.updateMany({
        where: { userId: telegramId, learned: false },
        data: { [passedField]: false },
      });

      count = totalNonLearned;
    }

    const skip = Math.floor(Math.random() * count);
    const word = await this.prisma.word.findFirst({
      where: availableWhere,
      skip,
    });

    if (!word) {
      throw new Error('Не вдалося знайти слово');
    }

    await this.prisma.word.update({
      where: { id: word.id },
      data: { [passedField]: true },
    });

    return word;
  }

  async markLearned(wordId: string): Promise<void> {
    await this.prisma.word.update({
      where: { id: wordId },
      data: { learned: true },
    });
  }

  async unmarkLearned(wordId: string): Promise<void> {
    await this.prisma.word.update({
      where: { id: wordId },
      data: { learned: false },
    });
  }

  async clearAllLearned(telegramId: bigint): Promise<number> {
    const result = await this.prisma.word.updateMany({
      where: { userId: telegramId, learned: true },
      data: { learned: false },
    });
    return result.count;
  }

  async getLearnedWords(telegramId: bigint): Promise<Word[]> {
    return this.prisma.word.findMany({
      where: { userId: telegramId, learned: true },
      orderBy: { english: 'asc' },
    });
  }

  async getStats(telegramId: bigint): Promise<WordStats> {
    const [total, learned, passedEn, passedUk] = await Promise.all([
      this.prisma.word.count({ where: { userId: telegramId } }),
      this.prisma.word.count({ where: { userId: telegramId, learned: true } }),
      this.prisma.word.count({
        where: { userId: telegramId, learned: false, passedEn: true },
      }),
      this.prisma.word.count({
        where: { userId: telegramId, learned: false, passedUk: true },
      }),
    ]);

    return {
      total,
      learned,
      passedInCurrentEnCycle: passedEn,
      passedInCurrentUkCycle: passedUk,
    };
  }
}
