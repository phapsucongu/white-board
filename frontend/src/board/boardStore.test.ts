import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardObject } from '@whiteboard/shared';
import {
  createLocalRectangleObject,
  getVisibleBoardObjects,
  normalizeRectangle,
  useBoardStore
} from './boardStore';

describe('boardStore', () => {
  beforeEach(() => {
    useBoardStore.setState({
      boardVersion: 0,
      objects: {},
      roomId: null,
      selectedObjectIds: new Set(),
      tool: 'select',
      viewport: {
        x: 0,
        y: 0,
        scale: 1
      }
    });
  });

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

  it('normalizes rectangle drag direction', () => {
    expect(normalizeRectangle({ x: 120, y: 90 }, { x: 40, y: 160 })).toEqual({
      x: 40,
      y: 90,
      width: 80,
      height: 70
    });
  });

  it('creates a local rectangle board object with required metadata', () => {
    const rectangle = createLocalRectangleObject({
      createdBy: 'user-1',
      end: { x: 80, y: 70 },
      id: 'rect-1',
      now: '2026-06-10T00:00:00.000Z',
      roomId: 'room-1',
      start: { x: 20, y: 30 }
    });

    expect(rectangle).toMatchObject({
      id: 'rect-1',
      type: 'rectangle',
      x: 20,
      y: 30,
      createdBy: 'user-1',
      updatedBy: 'user-1',
      updatedAt: '2026-06-10T00:00:00.000Z',
      props: {
        fill: '#dbeafe',
        height: 40,
        stroke: '#1f6feb',
        width: 60
      }
    });
  });

  it('applies accepted create events without duplicating existing objects', () => {
    const acceptedEvent = {
      actorId: 'user-1',
      eventType: 'object:create' as const,
      payload: {
        object: {
          id: 'rect-1',
          type: 'rectangle' as const,
          x: 20,
          y: 30,
          props: {
            fill: '#dbeafe',
            height: 40,
            stroke: '#1f6feb',
            width: 60
          }
        }
      },
      roomId: 'room-1',
      serverTime: '2026-06-10T00:00:00.000Z',
      version: 3
    };

    useBoardStore.getState().applyAcceptedCreateEvent(acceptedEvent);
    useBoardStore.getState().applyAcceptedCreateEvent(acceptedEvent);

    const state = useBoardStore.getState();
    expect(state.boardVersion).toBe(3);
    expect(Object.keys(state.objects)).toEqual(['rect-1']);
    expect(state.objects['rect-1']).toMatchObject({
      id: 'rect-1',
      roomId: 'room-1',
      type: 'rectangle',
      version: 1,
      createdBy: 'user-1',
      updatedBy: 'user-1'
    });
  });

  it('applies accepted update events and ignores duplicate versions', () => {
    const existing = createBoardObject('rect-1');
    useBoardStore.setState({
      boardVersion: 1,
      objects: {
        [existing.id]: {
          ...existing,
          props: {
            width: 60,
            height: 40,
            stroke: '#1f6feb'
          },
          version: 1
        }
      }
    });

    const updateEvent = {
      actorId: 'user-2',
      eventType: 'object:update' as const,
      payload: {
        objectId: 'rect-1',
        patch: {
          x: 24,
          y: 36,
          props: {
            width: 80
          }
        }
      },
      roomId: 'room-1',
      serverTime: '2026-06-10T01:00:00.000Z',
      version: 2
    };

    useBoardStore.getState().applyAcceptedUpdateEvent(updateEvent);
    useBoardStore.getState().applyAcceptedUpdateEvent(updateEvent);

    const state = useBoardStore.getState();
    expect(state.boardVersion).toBe(2);
    expect(state.objects['rect-1']).toMatchObject({
      x: 24,
      y: 36,
      version: 2,
      updatedBy: 'user-2',
      updatedAt: '2026-06-10T01:00:00.000Z',
      props: {
        width: 80,
        height: 40,
        stroke: '#1f6feb'
      }
    });
  });

  it('applies accepted delete events and clears deleted selection', () => {
    const existing = createBoardObject('rect-1');
    useBoardStore.setState({
      boardVersion: 1,
      objects: {
        [existing.id]: {
          ...existing,
          version: 1
        }
      },
      selectedObjectIds: new Set([existing.id])
    });

    const deleteEvent = {
      actorId: 'user-2',
      eventType: 'object:delete' as const,
      payload: {
        objectId: 'rect-1',
        expectedVersion: 1
      },
      roomId: 'room-1',
      serverTime: '2026-06-10T01:00:00.000Z',
      version: 2
    };

    useBoardStore.getState().applyAcceptedDeleteEvent(deleteEvent);
    useBoardStore.getState().applyAcceptedDeleteEvent(deleteEvent);

    const state = useBoardStore.getState();
    expect(state.boardVersion).toBe(2);
    expect(state.selectedObjectIds.size).toBe(0);
    expect(state.objects['rect-1']).toMatchObject({
      deleted: true,
      version: 2,
      updatedBy: 'user-2',
      updatedAt: '2026-06-10T01:00:00.000Z'
    });
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
