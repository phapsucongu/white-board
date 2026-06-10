import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { RequiredRoomRole } from '../permissions/required-room-role.decorator';
import { RoomMemberGuard } from '../permissions/room-member.guard';
import { RoomRole } from '../permissions/room-role.enum';
import { AddRoomMemberDto } from './dto/add-room-member.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomMemberDto } from './dto/update-room-member.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomsService } from './rooms.service';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateRoomDto) {
    return this.roomsService.createRoom(request.user.id, dto);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.roomsService.listRoomsForUser(request.user.id);
  }

  @Get(':roomId/members')
  @UseGuards(RoomMemberGuard)
  listMembers(@Param('roomId') roomId: string) {
    return this.roomsService.listMembers(roomId);
  }

  @Post(':roomId/members')
  @RequiredRoomRole(RoomRole.OWNER)
  @UseGuards(RoomMemberGuard)
  addMember(@Param('roomId') roomId: string, @Body() dto: AddRoomMemberDto) {
    return this.roomsService.addMember(roomId, dto);
  }

  @Patch(':roomId/members/:userId')
  @RequiredRoomRole(RoomRole.OWNER)
  @UseGuards(RoomMemberGuard)
  updateMember(
    @Req() request: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateRoomMemberDto
  ) {
    return this.roomsService.updateMemberRole(roomId, userId, request.user.id, dto);
  }

  @Delete(':roomId/members/:userId')
  @RequiredRoomRole(RoomRole.OWNER)
  @UseGuards(RoomMemberGuard)
  removeMember(
    @Req() request: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Param('userId') userId: string
  ) {
    return this.roomsService.removeMember(roomId, userId, request.user.id);
  }

  @Get(':roomId')
  getById(@Req() request: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.roomsService.getRoomForMember(roomId, request.user.id);
  }

  @Patch(':roomId')
  @RequiredRoomRole(RoomRole.OWNER)
  @UseGuards(RoomMemberGuard)
  update(@Param('roomId') roomId: string, @Body() dto: UpdateRoomDto) {
    return this.roomsService.updateRoom(roomId, dto);
  }

  @Delete(':roomId')
  @RequiredRoomRole(RoomRole.OWNER)
  @UseGuards(RoomMemberGuard)
  remove(@Param('roomId') roomId: string) {
    return this.roomsService.deleteRoom(roomId);
  }
}
