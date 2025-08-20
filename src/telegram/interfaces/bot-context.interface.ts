import { Context } from 'telegraf';

export interface BotContext extends Context {
  session?: {
    awaitingSheetUrl?: boolean;
    currentMenu?: 'main' | 'learning';
  };
}
