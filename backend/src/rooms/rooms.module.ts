import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardModule } from '../board/board.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { VersionHistoryController } from './version-history.controller';
import { VersionHistoryService } from './version-history.service';

@Module({
  imports: [AuthModule, BoardModule, PermissionsModule, PrismaModule, UsersModule],
  controllers: [RoomsController, VersionHistoryController],
  providers: [RoomsService, VersionHistoryService],
  exports: [RoomsService, VersionHistoryService]
})
export class RoomsModule {}
