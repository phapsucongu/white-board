import { IsEnum } from 'class-validator';
import { RoomRole } from '../../permissions/room-role.enum';

export class UpdateRoomMemberDto {
  @IsEnum(RoomRole)
  role!: RoomRole;
}
