import { SetMetadata } from '@nestjs/common';
import { RoomRole } from './room-role.enum';

export const REQUIRED_ROOM_ROLE_KEY = 'requiredRoomRole';

export const RequiredRoomRole = (role: RoomRole) => SetMetadata(REQUIRED_ROOM_ROLE_KEY, role);
