import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardModule } from '../board/board.module';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { PresenceService } from './presence.service';
import { RealtimeRoomEventsService } from './realtime-room-events.service';
import { RoomGateway } from './room.gateway';

@Module({
  imports: [AuthModule, BoardModule, CollaborationModule, PrismaModule, UsersModule],
  providers: [PresenceService, RealtimeRoomEventsService, RoomGateway],
  exports: [PresenceService, RealtimeRoomEventsService, RoomGateway]
})
export class RealtimeModule {}
