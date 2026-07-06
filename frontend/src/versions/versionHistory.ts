import type { BoardVersionEvent, RoomRole, VersionTag } from '../api/client';

export function canCreateVersionTag(role?: RoomRole): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}

export function formatVersionEventType(eventType: string): string {
  return eventType
    .split(':')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getTagsForVersion(tags: VersionTag[], version: number): VersionTag[] {
  return tags.filter((tag) => tag.version === version);
}

export function getVersionActorLabel(event: BoardVersionEvent): string {
  return event.actorId;
}
