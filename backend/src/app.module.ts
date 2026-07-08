import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { RateLimitGuard } from './common/rate-limit.guard';
import { AuthModule } from './auth/auth.module';
import { BoardModule } from './board/board.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RoomsModule } from './rooms/rooms.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['../.env', '.env'],
      isGlobal: true
    }),
    AuthModule,
    BoardModule,
    PermissionsModule,
    PrismaModule,
    RealtimeModule,
    RoomsModule,
    UsersModule
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard
    }
  ],
  exports: [PrismaModule]
})
export class AppModule {}
