import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types';
import { canSatisfyRequiredRoomRole } from './room-permissions';
import { REQUIRED_ROOM_ROLE_KEY } from './required-room-role.decorator';
import { RoomRole } from './room-role.enum';

type RoomGuardRequest = {
  body?: {
    roomId?: unknown;
  };
  params?: {
    roomId?: unknown;
  };
  query?: {
    roomId?: unknown;
  };
  roomMembership?: {
    roomId: string;
    role: RoomRole;
  };
  user?: AuthenticatedUser;
};

@Injectable()
export class RoomMemberGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RoomGuardRequest>();

    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }

    const roomId = this.extractRoomId(request);

    if (!roomId) {
      throw new BadRequestException('roomId is required');
    }

    const requiredRole =
      this.reflector.getAllAndOverride<RoomRole>(REQUIRED_ROOM_ROLE_KEY, [
        context.getHandler(),
        context.getClass()
      ]) ?? RoomRole.VIEWER;

    const membership = await this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: request.user.id
        }
      },
      select: {
        roomId: true,
        role: true
      }
    });

    if (!membership) {
      throw new NotFoundException('Room not found');
    }

    const actualRole = membership.role as RoomRole;

    if (!canSatisfyRequiredRoomRole(actualRole, requiredRole)) {
      throw new ForbiddenException('Insufficient room permissions');
    }

    request.roomMembership = {
      roomId: membership.roomId,
      role: actualRole
    };

    return true;
  }

  private extractRoomId(request: RoomGuardRequest): string | null {
    const roomId = request.params?.roomId ?? request.body?.roomId ?? request.query?.roomId;

    return typeof roomId === 'string' && roomId.trim() ? roomId : null;
  }
}
