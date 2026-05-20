import { Injectable, Logger } from '@nestjs/common';
import { Word } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type LearningMode = 'en' | 'uk';

export interface WordStats {
  total: number;
  learnedEn: number;
  learnedUk: number;
  passedInCurrentEnCycle: number;
  passedInCurrentUkCycle: number;
  notLearnedEn: number;
  notLearnedUk: number;
}

const FIELDS = {
  en: { passed: 'passedEn', learned: 'learnedEn', review: 'reviewCountEn' },
  uk: { passed: 'passedUk', learned: 'learnedUk', review: 'reviewCountUk' },
} as const;

export interface ReviewStats {
  learnedEn: number;
  learnedUk: number;
  minReviewCountEn: number | null;
  minReviewCountUk: number | null;
}

@Injectable()
export class WordsService {
  private readonly logger = new Logger(WordsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Випадкове слово з тих, що не вивчені у цьому напрямку і ще не пройдені в поточному циклі.
   * Коли всі непройдені вичерпались — скидаємо passed-мітку і починаємо нове коло.
   */
  async getRandomWord(telegramId: bigint, mode: LearningMode): Promise<Word> {
    const { passed: passedField, learned: learnedField } = FIELDS[mode];

    const availableWhere = {
      userId: telegramId,
      [learnedField]: false,
      [passedField]: false,
    };

    let count = await this.prisma.word.count({ where: availableWhere });

    if (count === 0) {
      const totalNotLearned = await this.prisma.word.count({
        where: { userId: telegramId, [learnedField]: false },
      });

      if (totalNotLearned === 0) {
        throw new Error(
          `Немає слів для напрямку "${mode === 'en' ? '🇺🇸 → 🇺🇦' : '🇺🇦 → 🇺🇸'}". ` +
            `Натисніть "🔄 Синхронізувати" або зніміть мітки "вивчено".`,
        );
      }

      this.logger.log(`Скидаємо цикл ${mode} для user ${telegramId}`);
      await this.prisma.word.updateMany({
        where: { userId: telegramId, [learnedField]: false },
        data: { [passedField]: false },
      });

      count = totalNotLearned;
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

  /**
   * Вивчене слово в напрямку, у якому його показали.
   * EN-напрямок і UK-напрямок незалежні.
   */
  async markLearned(wordId: string, mode: LearningMode): Promise<void> {
    const { learned: learnedField } = FIELDS[mode];
    await this.prisma.word.update({
      where: { id: wordId },
      data: { [learnedField]: true },
    });
  }

  /**
   * Знімає мітку "вивчено" з обох напрямків — слово знову потрапить у навчання.
   */
  async unmarkLearned(wordId: string): Promise<void> {
    await this.prisma.word.update({
      where: { id: wordId },
      data: { learnedEn: false, learnedUk: false },
    });
  }

  /**
   * Знімає "вивчено" з усіх слів юзера (обидва напрямки).
   */
  async clearAllLearned(telegramId: bigint): Promise<number> {
    const result = await this.prisma.word.updateMany({
      where: {
        userId: telegramId,
        OR: [{ learnedEn: true }, { learnedUk: true }],
      },
      data: { learnedEn: false, learnedUk: false },
    });
    return result.count;
  }

  /**
   * Список усіх слів, які вивчені хоч в одному напрямку.
   */
  async getLearnedWords(telegramId: bigint): Promise<Word[]> {
    return this.prisma.word.findMany({
      where: {
        userId: telegramId,
        OR: [{ learnedEn: true }, { learnedUk: true }],
      },
      orderBy: { english: 'asc' },
    });
  }

  /**
   * Випадкове вивчене слово з мінімальним лічильником повторень у цьому напрямку.
   * Серед слів з однаковим лічильником — рандом.
   */
  async getReviewWord(telegramId: bigint, mode: LearningMode): Promise<Word> {
    const { learned: learnedField, review: countField } = FIELDS[mode];

    const minAgg = await this.prisma.word.aggregate({
      where: { userId: telegramId, [learnedField]: true },
      _min: { [countField]: true },
    });

    const minCount = (minAgg._min as Record<string, number | null>)[countField];
    if (minCount === null || minCount === undefined) {
      throw new Error(
        `Немає вивчених слів у напрямку "${mode === 'en' ? '🇺🇸 → 🇺🇦' : '🇺🇦 → 🇺🇸'}". ` +
          `Спочатку повчіть їх у меню навчання.`,
      );
    }

    const where = {
      userId: telegramId,
      [learnedField]: true,
      [countField]: minCount,
    };
    const total = await this.prisma.word.count({ where });
    const skip = Math.floor(Math.random() * total);
    const word = await this.prisma.word.findFirst({ where, skip });

    if (!word) {
      throw new Error('Не вдалося знайти слово для повторення');
    }
    return word;
  }

  async markReviewed(wordId: string, mode: LearningMode): Promise<void> {
    const { review: countField } = FIELDS[mode];
    await this.prisma.word.update({
      where: { id: wordId },
      data: { [countField]: { increment: 1 } },
    });
  }

  async getReviewStats(telegramId: bigint): Promise<ReviewStats> {
    const [learnedEn, learnedUk, minEn, minUk] = await Promise.all([
      this.prisma.word.count({ where: { userId: telegramId, learnedEn: true } }),
      this.prisma.word.count({ where: { userId: telegramId, learnedUk: true } }),
      this.prisma.word.aggregate({
        where: { userId: telegramId, learnedEn: true },
        _min: { reviewCountEn: true },
      }),
      this.prisma.word.aggregate({
        where: { userId: telegramId, learnedUk: true },
        _min: { reviewCountUk: true },
      }),
    ]);
    return {
      learnedEn,
      learnedUk,
      minReviewCountEn: minEn._min.reviewCountEn,
      minReviewCountUk: minUk._min.reviewCountUk,
    };
  }

  async getStats(telegramId: bigint): Promise<WordStats> {
    const [total, learnedEn, learnedUk, passedEn, passedUk] = await Promise.all([
      this.prisma.word.count({ where: { userId: telegramId } }),
      this.prisma.word.count({ where: { userId: telegramId, learnedEn: true } }),
      this.prisma.word.count({ where: { userId: telegramId, learnedUk: true } }),
      this.prisma.word.count({
        where: { userId: telegramId, learnedEn: false, passedEn: true },
      }),
      this.prisma.word.count({
        where: { userId: telegramId, learnedUk: false, passedUk: true },
      }),
    ]);

    return {
      total,
      learnedEn,
      learnedUk,
      passedInCurrentEnCycle: passedEn,
      passedInCurrentUkCycle: passedUk,
      notLearnedEn: total - learnedEn,
      notLearnedUk: total - learnedUk,
    };
  }
}
