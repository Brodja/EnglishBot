import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoomDocument = Room & Document;

export enum RoomStatus {
  WAITING = 'waiting',     // Очікування учасників
  ACTIVE = 'active',       // Гра активна (розподіл зроблено)
  FINISHED = 'finished'    // Гра завершена
}

@Schema({ timestamps: true })
export class Room {
  @Prop({ required: true, unique: true })
  roomId: string; // Унікальний ID кімнати (6-значний номер)

  @Prop({ required: true })
  name: string; // Назва кімнати

  @Prop({ required: true })
  adminId: number; // Telegram ID адміністратора

  @Prop({ type: [Number], default: [] })
  participants: number[]; // Список Telegram ID учасників

  @Prop({ type: String, enum: RoomStatus, default: RoomStatus.WAITING })
  status: RoomStatus;

  @Prop({ type: Date })
  gameStartedAt?: Date; // Коли був зроблений розподіл

  @Prop({ type: Object, default: {} })
  assignments?: { [telegramId: string]: number }; // Хто кому дарує
}

export const RoomSchema = SchemaFactory.createForClass(Room);
