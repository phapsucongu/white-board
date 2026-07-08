import { ConflictException, Injectable } from '@nestjs/common';
import type { BoardEvent as PrismaBoardEvent } from '@prisma/client';
import type { BoardObject, BoardObjectId } from '@whiteboard/shared';
import type {
  ApplyBoardEventInput,
  BoardEventType,
  BoardObjectPatch,
  BoardSnapshot,
  UpdateBoardObjectPayload
} from './board.service';
import { decodeBoardEventPayload } from './board-event-payload.codec';

export type BoardConflictDetails = {
  currentVersion: number;
  objectId?: BoardObjectId;
  conflictingFields: string[];
  clientPatch?: BoardObjectPatch;
  serverPatch?: BoardObjectPatch;
  currentObject?: BoardObject | null;
};

export class BoardConflictException extends ConflictException {
  constructor(readonly details: BoardConflictDetails, message = 'Board version conflict') {
    super({
      message,
      reason: 'VERSION_CONFLICT',
      details
    });
  }
}

@Injectable()
export class ConflictResolutionService {
  resolveStaleEvent({
    currentSnapshot,
    currentVersion,
    input,
    missedEvents
  }: {
    currentSnapshot: BoardSnapshot;
    currentVersion: number;
    input: ApplyBoardEventInput;
    missedEvents: PrismaBoardEvent[];
  }): ApplyBoardEventInput {
    if (typeof input.baseVersion === 'number' && input.baseVersion > currentVersion) {
      throw new BoardConflictException({
        currentVersion,
        conflictingFields: ['board.version']
      });
    }

    // A create of a brand-new object id never actually conflicts with concurrent
    // edits to other objects — only reject if that id already exists.
    if (input.eventType === 'object:create') {
      return this.resolveStaleCreate({ currentSnapshot, currentVersion, input, missedEvents });
    }

    // A delete can be rebased onto the current version: it wins over concurrent
    // updates. Only reject if the object is already gone.
    if (input.eventType === 'object:delete') {
      return this.resolveStaleDelete({ currentSnapshot, currentVersion, input });
    }

    if (input.eventType !== 'object:update' || !this.isUpdatePayload(input.payload)) {
      throw new BoardConflictException({
        currentVersion,
        conflictingFields: ['board.version']
      });
    }

    const objectId = input.payload.objectId;
    const currentObject = currentSnapshot.objects[objectId] ?? null;

    if (!currentObject || currentObject.deleted) {
      throw new BoardConflictException(
        {
          currentVersion,
          objectId,
          conflictingFields: ['object.deleted'],
          clientPatch: input.payload.patch,
          currentObject
        },
        'Board object was removed'
      );
    }

    const clientFields = this.getPatchFieldPaths(input.payload.patch);
    const conflictingFields = new Set<string>();
    let serverPatch: BoardObjectPatch = {};

    for (const missedEvent of missedEvents) {
      const missedPayload = decodeBoardEventPayload(missedEvent.eventType, missedEvent.payloadJson);

      if (!this.isBoardObjectEventType(missedEvent.eventType)) {
        conflictingFields.add('board.snapshot');
        continue;
      }

      if (!this.touchesObject(missedEvent.eventType as BoardEventType, missedPayload, objectId)) {
        continue;
      }

      if (missedEvent.eventType === 'object:delete' || missedEvent.eventType === 'object:create') {
        conflictingFields.add(missedEvent.eventType === 'object:delete' ? 'object.deleted' : 'object.identity');
        continue;
      }

      if (missedEvent.eventType !== 'object:update' || !this.isUpdatePayload(missedPayload)) {
        conflictingFields.add('object.unknown');
        continue;
      }

      serverPatch = this.mergePatch(serverPatch, missedPayload.patch);
      const serverFields = this.getPatchFieldPaths(missedPayload.patch);

      for (const field of clientFields) {
        if (serverFields.has(field)) {
          conflictingFields.add(field);
        }
      }
    }

    if (conflictingFields.size > 0) {
      throw new BoardConflictException({
        currentVersion,
        objectId,
        conflictingFields: [...conflictingFields].sort(),
        clientPatch: input.payload.patch,
        serverPatch,
        currentObject
      });
    }

    return {
      ...input,
      payload: {
        ...input.payload,
        expectedVersion: undefined
      }
    };
  }

  private resolveStaleCreate({
    currentSnapshot,
    currentVersion,
    input,
    missedEvents
  }: {
    currentSnapshot: BoardSnapshot;
    currentVersion: number;
    input: ApplyBoardEventInput;
    missedEvents: PrismaBoardEvent[];
  }): ApplyBoardEventInput {
    if (!this.isCreatePayload(input.payload)) {
      throw new BoardConflictException({ currentVersion, conflictingFields: ['board.version'] });
    }

    const objectId = input.payload.object.id;
    const alreadyExists = Boolean(currentSnapshot.objects[objectId]);
    const missedTouchedSameId = missedEvents.some(
      (missedEvent) =>
        this.isBoardObjectEventType(missedEvent.eventType) &&
        this.touchesObject(
          missedEvent.eventType as BoardEventType,
          decodeBoardEventPayload(missedEvent.eventType, missedEvent.payloadJson),
          objectId
        )
    );

    if (alreadyExists || missedTouchedSameId) {
      throw new BoardConflictException(
        {
          currentVersion,
          objectId,
          conflictingFields: ['object.identity'],
          currentObject: currentSnapshot.objects[objectId] ?? null
        },
        'Board object already exists'
      );
    }

    return input;
  }

  private resolveStaleDelete({
    currentSnapshot,
    currentVersion,
    input
  }: {
    currentSnapshot: BoardSnapshot;
    currentVersion: number;
    input: ApplyBoardEventInput;
  }): ApplyBoardEventInput {
    if (!this.isObjectPayload(input.payload)) {
      throw new BoardConflictException({ currentVersion, conflictingFields: ['board.version'] });
    }

    const objectId = input.payload.objectId;
    const currentObject = currentSnapshot.objects[objectId] ?? null;

    if (!currentObject || currentObject.deleted) {
      throw new BoardConflictException(
        {
          currentVersion,
          objectId,
          conflictingFields: ['object.deleted'],
          currentObject
        },
        'Board object was already removed'
      );
    }

    // Drop the stale expectedVersion so the delete applies to the current object.
    return {
      ...input,
      payload: {
        ...input.payload,
        expectedVersion: undefined
      }
    };
  }

  private isBoardObjectEventType(eventType: string): eventType is BoardEventType {
    return eventType === 'object:create' || eventType === 'object:update' || eventType === 'object:delete';
  }

  private touchesObject(eventType: BoardEventType, payload: unknown, objectId: BoardObjectId): boolean {
    if (eventType === 'object:create') {
      return this.isCreatePayload(payload) && payload.object.id === objectId;
    }

    if (eventType === 'object:update' || eventType === 'object:delete') {
      return this.isObjectPayload(payload) && payload.objectId === objectId;
    }

    return false;
  }

  private getPatchFieldPaths(patch: BoardObjectPatch): Set<string> {
    const fields = new Set<string>();

    for (const scalar of ['x', 'y', 'rotation'] as const) {
      if (patch[scalar] !== undefined) {
        fields.add(scalar);
      }
    }

    for (const key of Object.keys(patch.props ?? {})) {
      fields.add(`props.${key}`);
    }

    for (const key of Object.keys(patch.metadata ?? {})) {
      fields.add(`metadata.${key}`);
    }

    return fields;
  }

  private mergePatch(first: BoardObjectPatch, second: BoardObjectPatch): BoardObjectPatch {
    return {
      ...first,
      ...second,
      props: {
        ...(first.props ?? {}),
        ...(second.props ?? {})
      },
      metadata: {
        ...(first.metadata ?? {}),
        ...(second.metadata ?? {})
      }
    };
  }

  private isCreatePayload(value: unknown): value is { object: { id: BoardObjectId } } {
    return this.isRecord(value) && this.isRecord(value.object) && typeof value.object.id === 'string';
  }

  private isObjectPayload(value: unknown): value is { objectId: BoardObjectId } {
    return this.isRecord(value) && typeof value.objectId === 'string';
  }

  private isUpdatePayload(value: unknown): value is UpdateBoardObjectPayload {
    return (
      this.isObjectPayload(value) &&
      this.isRecord((value as { patch?: unknown }).patch)
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
