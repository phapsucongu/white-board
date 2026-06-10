import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomMemberGuard } from './room-member.guard';

@Module({
  imports: [PrismaModule],
  providers: [RoomMemberGuard],
  exports: [RoomMemberGuard]
})
export class PermissionsModule {}
