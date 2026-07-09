import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiredRoomRole } from '../permissions/required-room-role.decorator';
import { RoomMemberGuard } from '../permissions/room-member.guard';
import { RoomRole } from '../permissions/room-role.enum';
import { CreateVersionTagDto } from './dto/create-version-tag.dto';
import { VersionHistoryService } from './version-history.service';

@Controller('rooms/:roomId/versions')
@UseGuards(JwtAuthGuard, RoomMemberGuard)
export class VersionHistoryController {
  constructor(private readonly versionHistoryService: VersionHistoryService) {}

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
  restoreVersion(
    @Param('roomId') roomId: string,
    @Param('version', ParseIntPipe) version: number,
    @Req() request: { user: { id: string } }
  ) {
    return this.versionHistoryService.restoreVersion(roomId, version, request.user.id);
  }
}
