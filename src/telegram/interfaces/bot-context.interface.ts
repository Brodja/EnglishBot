import { Context } from 'telegraf';

export interface BotContext extends Context {
  session?: {
    awaitingRoomName?: boolean;
    awaitingDisplayName?: boolean;
    awaitingGiftDescription?: boolean;
    currentRoomId?: string;
    isNameChange?: boolean;
    isJoiningRoom?: boolean;
    tempDisplayName?: string;
  };
}
