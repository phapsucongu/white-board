import { describe, expect, it } from 'vitest';
import type { BoardObject } from '@whiteboard/shared';
import {
  canMutateRoom,
  getPresenceDisplayName,
  normalizePresenceUsers,
  toCreateBoardObjectPayload,
  toDeleteBoardObjectPayload,
  toMoveBoardObjectPayload,
  toResizeRectanglePayload
} from './useRoomRealtime';

describe('useRoomRealtime helpers', () => {
  it('allows only owners and editors to mutate a room', () => {
    expect(canMutateRoom('OWNER')).toBe(true);
    expect(canMutateRoom('EDITOR')).toBe(true);
    expect(canMutateRoom('VIEWER')).toBe(false);
    expect(canMutateRoom(undefined)).toBe(false);
  });

  it('falls back to email for presence display names', () => {
    expect(
      getPresenceDisplayName({
        userId: 'user-1',
        email: 'alice@example.com',
        displayName: '  ',
        role: 'EDITOR',
        socketIds: ['socket-1'],
        joinedAt: '2026-06-10T00:00:00.000Z'
      })
    ).toBe('alice@example.com');
  });

  it('sorts presence users by display name for stable rendering', () => {
    expect(
      normalizePresenceUsers([
        {
          userId: 'user-2',
          email: 'zane@example.com',
          displayName: 'Zane',
          role: 'VIEWER',
          socketIds: ['socket-2'],
          joinedAt: '2026-06-10T00:00:00.000Z'
        },
        {
          userId: 'user-1',
          email: 'alice@example.com',
          displayName: 'Alice',
          role: 'OWNER',
          socketIds: ['socket-1'],
          joinedAt: '2026-06-10T00:00:00.000Z'
        }
      ]).map((user) => user.userId)
    ).toEqual(['user-1', 'user-2']);
  });

  it('converts a rectangle board object into an object:create payload', () => {
    const rectangle: BoardObject = {
      id: 'rect-1',
      roomId: 'room-1',
      type: 'rectangle',
      x: 10,
      y: 20,
      rotation: 0,
      version: 0,
      createdBy: 'user-1',
      updatedBy: 'user-1',
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:00:00.000Z',
      props: {
        fill: '#dbeafe',
        height: 40,
        stroke: '#1f6feb',
        width: 80
      }
    };

    expect(toCreateBoardObjectPayload(rectangle)).toEqual({
      object: {
        id: 'rect-1',
        type: 'rectangle',
        x: 10,
        y: 20,
        rotation: 0,
        props: {
          fill: '#dbeafe',
          height: 40,
          stroke: '#1f6feb',
          width: 80
        },
        metadata: undefined
      }
    });
  });

  it('creates a minimal move update payload', () => {
    expect(toMoveBoardObjectPayload('rect-1', { x: 44, y: 55 })).toEqual({
      objectId: 'rect-1',
      patch: {
        x: 44,
        y: 55
      }
    });
  });

  it('creates a minimal rectangle resize update payload', () => {
    expect(
      toResizeRectanglePayload('rect-1', {
        x: 12,
        y: 24,
        width: 160,
        height: 90
      })
    ).toEqual({
      objectId: 'rect-1',
      patch: {
        x: 12,
        y: 24,
        props: {
          width: 160,
          height: 90
        }
      }
    });
  });

  it('creates a delete payload with an optional expected object version', () => {
    expect(toDeleteBoardObjectPayload('rect-1', 2)).toEqual({
      objectId: 'rect-1',
      expectedVersion: 2
    });
  });
});
