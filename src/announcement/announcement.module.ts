import { Module } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';

@Module({
  providers: [AnnouncementService],
  exports: [AnnouncementService],
})
export class AnnouncementModule {}
