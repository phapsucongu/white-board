import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BoardService } from './board.service';
import { ConflictResolutionService } from './conflict-resolution.service';

@Module({
  imports: [PrismaModule],
  providers: [BoardService, ConflictResolutionService],
  exports: [BoardService, ConflictResolutionService]
})
export class BoardModule {}
