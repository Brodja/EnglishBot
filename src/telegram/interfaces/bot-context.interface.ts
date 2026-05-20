import { Context } from 'telegraf';

export interface BotContext extends Context {
  session?: {
    awaitingSheetUrl?: boolean;
    awaitingFeedback?: boolean;
    currentMenu?: 'main' | 'learning';
  };
}
