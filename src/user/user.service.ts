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
    displayName?: string;
  }): Promise<UserDocument> {
    const user = new this.userModel(userData);
    return user.save();
  }

  async updateDisplayName(telegramId: number, displayName: string): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      { displayName },
      { new: true, upsert: true }
    ).exec();
  }

  async updateGiftDescription(telegramId: number, description: string): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      { giftDescription: description },
      { new: true }
    ).exec();
  }

  async setCurrentRoom(telegramId: number, roomId: string): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      { currentRoomId: roomId },
      { new: true }
    ).exec();
  }

  async clearCurrentRoom(telegramId: number): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      { $unset: { currentRoomId: 1, assignedTo: 1 } },
      { new: true }
    ).exec();
  }

  async setAssignment(telegramId: number, assignedTo: number): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      { assignedTo },
      { new: true }
    ).exec();
  }

  async addToIgnoreList(telegramId: number, ignoreUserId: number): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      { $addToSet: { ignoreList: ignoreUserId } },
      { new: true }
    ).exec();
  }

  async removeFromIgnoreList(telegramId: number, ignoreUserId: number): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      { $pull: { ignoreList: ignoreUserId } },
      { new: true }
    ).exec();
  }

  async clearIgnoreList(telegramId: number): Promise<UserDocument> {
    return this.userModel.findOneAndUpdate(
      { telegramId },
      { ignoreList: [] },
      { new: true }
    ).exec();
  }

  async findMultipleByTelegramIds(telegramIds: number[]): Promise<UserDocument[]> {
    return this.userModel.find({ telegramId: { $in: telegramIds } }).exec();
  }
}
