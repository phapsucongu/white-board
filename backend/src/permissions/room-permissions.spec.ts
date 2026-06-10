import {
  canEditRoom,
  canManageRoom,
  canSatisfyRequiredRoomRole,
  canViewRoom
} from './room-permissions';
import { RoomRole } from './room-role.enum';

describe('room permission helpers', () => {
  it.each([RoomRole.OWNER, RoomRole.EDITOR, RoomRole.VIEWER])(
    'allows %s to view rooms',
    (role) => {
      expect(canViewRoom(role)).toBe(true);
    }
  );

  it('allows owner and editor to edit rooms', () => {
    expect(canEditRoom(RoomRole.OWNER)).toBe(true);
    expect(canEditRoom(RoomRole.EDITOR)).toBe(true);
    expect(canEditRoom(RoomRole.VIEWER)).toBe(false);
  });

  it('allows only owner to manage rooms', () => {
    expect(canManageRoom(RoomRole.OWNER)).toBe(true);
    expect(canManageRoom(RoomRole.EDITOR)).toBe(false);
    expect(canManageRoom(RoomRole.VIEWER)).toBe(false);
  });

  it('rejects missing roles', () => {
    expect(canViewRoom(null)).toBe(false);
    expect(canEditRoom(undefined)).toBe(false);
    expect(canManageRoom(null)).toBe(false);
  });

  it('maps required room roles to the centralized policy', () => {
    expect(canSatisfyRequiredRoomRole(RoomRole.OWNER, RoomRole.VIEWER)).toBe(true);
    expect(canSatisfyRequiredRoomRole(RoomRole.EDITOR, RoomRole.VIEWER)).toBe(true);
    expect(canSatisfyRequiredRoomRole(RoomRole.VIEWER, RoomRole.VIEWER)).toBe(true);

    expect(canSatisfyRequiredRoomRole(RoomRole.OWNER, RoomRole.EDITOR)).toBe(true);
    expect(canSatisfyRequiredRoomRole(RoomRole.EDITOR, RoomRole.EDITOR)).toBe(true);
    expect(canSatisfyRequiredRoomRole(RoomRole.VIEWER, RoomRole.EDITOR)).toBe(false);

    expect(canSatisfyRequiredRoomRole(RoomRole.OWNER, RoomRole.OWNER)).toBe(true);
    expect(canSatisfyRequiredRoomRole(RoomRole.EDITOR, RoomRole.OWNER)).toBe(false);
    expect(canSatisfyRequiredRoomRole(RoomRole.VIEWER, RoomRole.OWNER)).toBe(false);
  });
});
