import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { WordsService } from './services/words.service';
import { UserModule } from '../user/user.module';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';

@Module({
  imports: [UserModule, GoogleSheetsModule],
  providers: [TelegramService, WordsService],
})
export class TelegramModule {}
