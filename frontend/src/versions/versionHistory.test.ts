import { describe, expect, it } from 'vitest';
import {
  canCreateVersionTag,
  formatVersionEventType,
  getTagsForVersion,
  getVersionActorLabel
} from './versionHistory';

describe('versionHistory helpers', () => {
  it('allows only owners and editors to create version tags', () => {
    expect(canCreateVersionTag('OWNER')).toBe(true);
    expect(canCreateVersionTag('EDITOR')).toBe(true);
    expect(canCreateVersionTag('VIEWER')).toBe(false);
    expect(canCreateVersionTag(undefined)).toBe(false);
  });

  it('formats event types for display', () => {
    expect(formatVersionEventType('object:create')).toBe('Object Create');
    expect(formatVersionEventType('object:update')).toBe('Object Update');
  });

  it('filters tags for a specific version', () => {
    expect(
      getTagsForVersion(
        [
          {
            id: 'tag-1',
            roomId: 'room-1',
            version: 1,
            label: 'Start',
            createdAt: '2026-06-10T00:00:00.000Z'
          },
          {
            id: 'tag-2',
            roomId: 'room-1',
            version: 2,
            label: 'Review',
            createdAt: '2026-06-10T00:01:00.000Z'
          }
        ],
        2
      )
    ).toHaveLength(1);
  });

  it('uses actor id as the initial actor label', () => {
    expect(
      getVersionActorLabel({
        id: 'event-1',
        roomId: 'room-1',
        version: 1,
        eventType: 'object:create',
        payload: {},
        actorId: 'user-1',
        createdAt: '2026-06-10T00:00:00.000Z'
      })
    ).toBe('user-1');
  });
});
