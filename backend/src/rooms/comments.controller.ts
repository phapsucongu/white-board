import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { RoomMemberGuard } from '../permissions/room-member.guard';
import { RoomRole } from '../permissions/room-role.enum';
import { RoomGateway } from '../realtime/room.gateway';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

type RoomRequest = AuthenticatedRequest & {
  roomMembership?: {
    role: RoomRole;
  };
};

@Controller('rooms/:roomId/comments')
@UseGuards(JwtAuthGuard, RoomMemberGuard)
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly gateway: RoomGateway
  ) {}

  @Get()
  list(@Param('roomId') roomId: string) {
    return this.comments.list(roomId);
  }

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Body() dto: CreateCommentDto
  ) {
    const comment = await this.comments.create(roomId, request.user.id, dto);
    // Broadcast to all clients in the room
    this.gateway.broadcastToRoom(roomId, 'comment:new', { roomId, comment });
    return comment;
  }

  @Patch(':commentId')
  update(
    @Req() request: RoomRequest,
    @Param('roomId') roomId: string,
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto
  ) {
    return this.comments.update(
      roomId,
      commentId,
      request.user.id,
      request.roomMembership?.role ?? RoomRole.VIEWER,
      dto
    );
  }

  @Delete(':commentId')
  remove(
    @Req() request: RoomRequest,
    @Param('roomId') roomId: string,
    @Param('commentId') commentId: string
  ) {
    return this.comments.remove(
      roomId,
      commentId,
      request.user.id,
      request.roomMembership?.role ?? RoomRole.VIEWER
    );
  }
}
