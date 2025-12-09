import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  telegramId: number;

  @Prop()
  firstName?: string;

  @Prop()
  lastName?: string;

  @Prop()
  username?: string;

  @Prop()
  displayName?: string; // Ім'я для показу в кімнаті

  @Prop()
  currentRoomId?: string; // ID поточної кімнати

  @Prop()
  giftDescription?: string; // Опис бажаного подарунку

  @Prop()
  assignedTo?: number; // Telegram ID того, кому дарувати (після розподілу)

  @Prop({ type: [Number], default: [] })
  ignoreList?: number[]; // Список Telegram ID, яких ігнорувати при розподілі
}

export const UserSchema = SchemaFactory.createForClass(User);
