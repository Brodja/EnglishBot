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
  googleSheetsUrl?: string;

  @Prop({ type: Date })
  lastDataUpdate?: Date;

  @Prop({ type: Object })
  cachedWords?: {
    words: Array<{ english: string; translation: string }>;
    lastUpdated: Date;
  };

  @Prop({ type: Object })
  progress?: {
    englishShown: number[];
    translationShown: number[];
  };

  @Prop({ type: [String], default: [] })
  learnedWords?: string[]; // Список вивчених англійських слів
}

export const UserSchema = SchemaFactory.createForClass(User);
