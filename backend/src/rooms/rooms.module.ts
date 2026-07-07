import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardModule } from '../board/board.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { VersionHistoryController } from './version-history.controller';
import { VersionHistoryService } from './version-history.service';

@Module({
  imports: [AuthModule, BoardModule, PermissionsModule, PrismaModule, RealtimeModule, UsersModule],
  controllers: [RoomsController, CommentsController, VersionHistoryController],
  providers: [RoomsService, CommentsService, VersionHistoryService],
  exports: [RoomsService, CommentsService, VersionHistoryService]
})
export class RoomsModule {}
