import { describe, expect, it } from 'vitest';
import type { BoardObject } from '@whiteboard/shared';
import {
  canMutateRoom,
  toCreateBoardObjectPayload,
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
});
