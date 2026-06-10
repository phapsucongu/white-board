import { describe, expect, it } from 'vitest';
import type { BoardObject } from '@whiteboard/shared';
import { getVisibleBoardObjects } from './boardStore';

describe('boardStore', () => {
  it('returns only non-deleted board objects for rendering', () => {
    const visibleObject = createBoardObject('visible-object');
    const deletedObject = createBoardObject('deleted-object', true);

    expect(
      getVisibleBoardObjects({
        [visibleObject.id]: visibleObject,
        [deletedObject.id]: deletedObject
      })
    ).toEqual([visibleObject]);
  });
});

function createBoardObject(id: string, deleted = false): BoardObject {
  return {
    id,
    roomId: 'room-1',
    type: 'rectangle',
    x: 0,
    y: 0,
    version: 0,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    deleted,
    props: {}
  };
}
