import { IsEnum, IsString, MinLength } from 'class-validator';
import { RoomRole } from '../../permissions/room-role.enum';

export class AddRoomMemberDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsEnum(RoomRole)
  role!: RoomRole;
}
