import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { WordsService } from './services/words.service';
import { SyncService } from './services/sync.service';
import { UserModule } from '../user/user.module';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { AnnouncementModule } from '../announcement/announcement.module';

@Module({
  imports: [UserModule, GoogleSheetsModule, FeedbackModule, AnnouncementModule],
  providers: [TelegramService, WordsService, SyncService],
})
export class TelegramModule {}
