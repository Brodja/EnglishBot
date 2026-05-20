import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findByTelegramId(telegramId: bigint): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  async upsertUser(data: {
    telegramId: bigint;
    firstName?: string;
    lastName?: string;
    username?: string;
  }): Promise<User> {
    return this.prisma.user.upsert({
      where: { telegramId: data.telegramId },
      create: data,
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
      },
    });
  }

  async setGoogleSheetsUrl(telegramId: bigint, url: string): Promise<User> {
    return this.prisma.user.update({
      where: { telegramId },
      data: { googleSheetsUrl: url },
    });
  }
}
