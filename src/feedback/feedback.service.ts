import { Injectable, Logger } from '@nestjs/common';
import { Feedback } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export class FeedbackRateLimitError extends Error {
  constructor(public readonly waitMinutes: number) {
    super(`Wait ${waitMinutes}m before next feedback`);
  }
}

const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 година

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Створює feedback. Кидає FeedbackRateLimitError якщо юзер вже писав менше години тому.
   */
  async create(userId: bigint, text: string): Promise<Feedback> {
    const last = await this.prisma.feedback.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (last) {
      const elapsed = Date.now() - last.createdAt.getTime();
      if (elapsed < RATE_LIMIT_MS) {
        const waitMinutes = Math.ceil((RATE_LIMIT_MS - elapsed) / 60000);
        throw new FeedbackRateLimitError(waitMinutes);
      }
    }

    const feedback = await this.prisma.feedback.create({
      data: { userId, text },
    });
    this.logger.log(`Feedback #${feedback.id} from user ${userId}`);
    return feedback;
  }

  /**
   * Останні N повідомлень з юзером (для адмінського перегляду).
   */
  async listRecent(limit = 20) {
    return this.prisma.feedback.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { telegramId: true, firstName: true, username: true },
        },
      },
    });
  }
}
