import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardModule } from '../board/board.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { PresenceService } from './presence.service';
import { RoomGateway } from './room.gateway';

@Module({
  imports: [AuthModule, BoardModule, PrismaModule, UsersModule],
  providers: [PresenceService, RoomGateway],
  exports: [PresenceService, RoomGateway]
})
export class RealtimeModule {}
