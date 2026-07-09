import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { BoardService } from '../board/board.service';
import { RequiredRoomRole } from '../permissions/required-room-role.decorator';
import { RoomMemberGuard } from '../permissions/room-member.guard';
import { RoomRole } from '../permissions/room-role.enum';
import { RoomGateway } from '../realtime/room.gateway';
import { CreateVersionTagDto } from './dto/create-version-tag.dto';
import { VersionHistoryService } from './version-history.service';

@Controller('rooms/:roomId/versions')
@UseGuards(JwtAuthGuard, RoomMemberGuard)
export class VersionHistoryController {
  constructor(
    private readonly versionHistoryService: VersionHistoryService,
    private readonly boardService: BoardService,
    private readonly gateway: RoomGateway
  ) {}

  @Get()
  list(@Param('roomId') roomId: string) {
    return this.versionHistoryService.listVersions(roomId);
  }

  @Post('tags')
  @RequiredRoomRole(RoomRole.EDITOR)
  createTag(@Param('roomId') roomId: string, @Body() dto: CreateVersionTagDto) {
    return this.versionHistoryService.createTag(roomId, dto);
  }

  @Get(':version')
  getVersion(@Param('roomId') roomId: string, @Param('version', ParseIntPipe) version: number) {
    return this.versionHistoryService.getVersion(roomId, version);
  }

  @Post(':version/restore')
  @RequiredRoomRole(RoomRole.EDITOR)
  async restoreVersion(
    @Param('roomId') roomId: string,
    @Param('version', ParseIntPipe) version: number,
    @Req() request: AuthenticatedRequest
  ) {
    const result = await this.versionHistoryService.restoreVersion(roomId, version, request.user.id);
    // Broadcast new board state to all clients in the room
    const boardState = await this.boardService.getBoardSnapshotForRoom(roomId);
    this.gateway.broadcastToRoom(roomId, 'board:snapshot:restored', {
      roomId,
      version: boardState.version,
      snapshot: { objects: boardState.objects }
    });
    return result;
  }
}
