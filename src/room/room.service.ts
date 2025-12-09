import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room, RoomDocument, RoomStatus } from './schemas/room.schema';

@Injectable()
export class RoomService {
  constructor(@InjectModel(Room.name) private roomModel: Model<RoomDocument>) {}

  /**
   * Генерує унікальний ID кімнати
   */
  private generateRoomId(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Створює нову кімнату
   */
  async createRoom(name: string, adminId: number): Promise<RoomDocument> {
    let roomId: string;
    let existingRoom: RoomDocument;

    // Генеруємо унікальний ID
    do {
      roomId = this.generateRoomId();
      existingRoom = await this.roomModel.findOne({ roomId }).exec();
    } while (existingRoom);

    const room = new this.roomModel({
      roomId,
      name,
      adminId,
      participants: [adminId], // Адмін автоматично додається
      status: RoomStatus.WAITING,
    });

    return room.save();
  }

  /**
   * Знаходить кімнату за ID
   */
  async findByRoomId(roomId: string): Promise<RoomDocument | null> {
    return this.roomModel.findOne({ roomId }).exec();
  }

  /**
   * Знаходить кімнату користувача
   */
  async findUserRoom(telegramId: number): Promise<RoomDocument | null> {
    return this.roomModel.findOne({ 
      participants: telegramId,
      status: { $in: [RoomStatus.WAITING, RoomStatus.ACTIVE] }
    }).exec();
  }

  /**
   * Додає учасника до кімнати
   */
  async addParticipant(roomId: string, telegramId: number): Promise<RoomDocument> {
    return this.roomModel.findOneAndUpdate(
      { roomId, status: RoomStatus.WAITING },
      { $addToSet: { participants: telegramId } },
      { new: true }
    ).exec();
  }

  /**
   * Видаляє учасника з кімнати
   */
  async removeParticipant(roomId: string, telegramId: number): Promise<RoomDocument> {
    return this.roomModel.findOneAndUpdate(
      { roomId },
      { $pull: { participants: telegramId } },
      { new: true }
    ).exec();
  }

  /**
   * Запускає гру (робить розподіл)
   */
  async startGame(roomId: string, assignments: { [telegramId: string]: number }): Promise<RoomDocument> {
    return this.roomModel.findOneAndUpdate(
      { roomId },
      { 
        status: RoomStatus.ACTIVE,
        assignments,
        gameStartedAt: new Date()
      },
      { new: true }
    ).exec();
  }

  /**
   * Перевіряє чи є користувач адміном кімнати
   */
  async isAdmin(roomId: string, telegramId: number): Promise<boolean> {
    const room = await this.roomModel.findOne({ roomId, adminId: telegramId }).exec();
    return !!room;
  }

  /**
   * Видаляє кімнату
   */
  async deleteRoom(roomId: string): Promise<void> {
    await this.roomModel.deleteOne({ roomId }).exec();
  }
}
