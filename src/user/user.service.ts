import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UserService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async findByTelegramId(telegramId: number): Promise<UserDocument | null> {
    return this.userModel.findOne({ telegramId }).exec();
  }

  async createUser(userData: {
    telegramId: number;
    firstName?: string;
    lastName?: string;
    username?: string;
  }): Promise<UserDocument> {
    const user = new this.userModel(userData);
    return user.save();
  }

  async updateGoogleSheetsUrl(telegramId: number, url: string): Promise<UserDocument> {
    console.log(`[UserService] Оновлюємо URL для користувача ${telegramId}: ${url}`);
    
    const result = await this.userModel.findOneAndUpdate(
      { telegramId },
      { googleSheetsUrl: url },
      { new: true, upsert: true }
    ).exec();
    
    console.log(`[UserService] Результат оновлення:`, result?.googleSheetsUrl ? '✅ Збережено' : '❌ Помилка');
    return result;
  }

  async updateCachedWords(
    telegramId: number,
    words: Array<{ english: string; translation: string }>
  ): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      {
        cachedWords: {
          words,
          lastUpdated: new Date(),
        },
        lastDataUpdate: new Date(),
      },
      { new: true }
    ).exec();
  }

  async updateProgress(
    telegramId: number,
    type: 'english' | 'translation',
    shownIndices: number[]
  ): Promise<UserDocument> {
    const updateField = type === 'english' ? 'progress.englishShown' : 'progress.translationShown';
    
    return this.userModel.findOneAndUpdate(
      { telegramId },
      { [updateField]: shownIndices },
      { new: true }
    ).exec();
  }

  async resetProgress(telegramId: number): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      {
        progress: {
          englishShown: [],
          translationShown: [],
        },
      },
      { new: true }
    ).exec();
  }
}
