import { RoomRole } from './room-role.enum';

export function canViewRoom(role: RoomRole | null | undefined): boolean {
  return role === RoomRole.OWNER || role === RoomRole.EDITOR || role === RoomRole.VIEWER;
}

export function canEditRoom(role: RoomRole | null | undefined): boolean {
  return role === RoomRole.OWNER || role === RoomRole.EDITOR;
}

export function canManageRoom(role: RoomRole | null | undefined): boolean {
  return role === RoomRole.OWNER;
}

export function canSatisfyRequiredRoomRole(
  actualRole: RoomRole | null | undefined,
  requiredRole: RoomRole
): boolean {
  if (requiredRole === RoomRole.OWNER) {
    return canManageRoom(actualRole);
  }

  if (requiredRole === RoomRole.EDITOR) {
    return canEditRoom(actualRole);
  }

  return canViewRoom(actualRole);
}
