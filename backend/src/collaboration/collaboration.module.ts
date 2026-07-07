import { Module } from '@nestjs/common';
import { BoardModule } from '../board/board.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CollaborationService } from './collaboration.service';

@Module({
  imports: [BoardModule, PrismaModule],
  providers: [CollaborationService],
  exports: [CollaborationService]
})
export class CollaborationModule {}
