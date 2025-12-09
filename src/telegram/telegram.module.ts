import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AssignmentService } from './services/assignment.service';
import { UserModule } from '../user/user.module';
import { RoomModule } from '../room/room.module';

@Module({
  imports: [UserModule, RoomModule],
  providers: [TelegramService, AssignmentService],
})
export class TelegramModule {}
