import { ConflictException, NotFoundException } from '@nestjs/common';
import type { BoardEvent, BoardState } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BoardService, type ApplyBoardEventResult, type BoardSnapshot } from './board.service';
import { BoardConflictException } from './conflict-resolution.service';

type BoardStateFindUniqueArgs = {
  where: {
    roomId: string;
  };
};

type BoardStateUpsertArgs = {
  where: {
    roomId: string;
  };
  create: {
    roomId: string;
    version: number;
    snapshotJson: Prisma.InputJsonValue;
  };
  update: {
    version: number;
    snapshotJson: Prisma.InputJsonValue;
  };
};

type BoardEventCreateArgs = {
  data: {
    roomId: string;
    version: number;
    eventType: string;
    payloadJson: Prisma.InputJsonValue;
    actorId: string;
    clientOpId?: string;
  };
};

type BoardEventFindManyArgs = {
  where: {
    roomId: string;
    version: {
      gt: number;
    };
  };
  orderBy: {
    version: 'asc' | 'desc';
  };
};

type PrismaMock = {
  boardState: {
    findUnique: jest.Mock<Promise<BoardState | null>, [BoardStateFindUniqueArgs]>;
    upsert: jest.Mock<Promise<BoardState>, [BoardStateUpsertArgs]>;
  };
  boardEvent: {
    create: jest.Mock<Promise<BoardEvent>, [BoardEventCreateArgs]>;
    findMany: jest.Mock<Promise<BoardEvent[]>, [BoardEventFindManyArgs]>;
  };
  $transaction: jest.Mock<
    Promise<ApplyBoardEventResult>,
    [(tx: PrismaMock) => Promise<ApplyBoardEventResult>]
  >;
  getEvents: () => BoardEvent[];
};

function createBoardState(
  roomId: string,
  version: number,
  snapshot: BoardSnapshot = { objects: {} }
): BoardState {
  return {
    id: `board-state-${roomId}`,
    roomId,
    version,
    snapshotJson: snapshot as unknown as Prisma.JsonValue,
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  };
}

function createPrismaMock(initialState: BoardState | null = null): PrismaMock {
  let boardState = initialState;
  const events: BoardEvent[] = [];

  const prisma: PrismaMock = {
    boardState: {
      findUnique: jest.fn(async ({ where }: BoardStateFindUniqueArgs) => {
        return boardState?.roomId === where.roomId ? boardState : null;
      }),
      upsert: jest.fn(async ({ where, create, update }: BoardStateUpsertArgs) => {
        const nextVersion = boardState?.roomId === where.roomId ? update.version : create.version;
        const nextSnapshot =
          boardState?.roomId === where.roomId ? update.snapshotJson : create.snapshotJson;

        boardState = {
          id: boardState?.id ?? `board-state-${where.roomId}`,
          roomId: where.roomId,
          version: nextVersion,
          snapshotJson: nextSnapshot as Prisma.JsonValue,
          updatedAt: new Date('2026-01-01T00:00:00.000Z')
        };

        return boardState;
      })
    },
    boardEvent: {
      create: jest.fn(async ({ data }: BoardEventCreateArgs) => {
        const event: BoardEvent = {
          id: `event-${events.length + 1}`,
          roomId: data.roomId,
          version: data.version,
          eventType: data.eventType,
          payloadJson: data.payloadJson as Prisma.JsonValue,
          actorId: data.actorId,
          clientOpId: data.clientOpId ?? null,
          createdAt: new Date('2026-01-01T00:00:00.000Z')
        };

        events.push(event);

        return event;
      }),
      findMany: jest.fn(async ({ where, orderBy }: BoardEventFindManyArgs) => {
        const rows = events.filter(
          (event) => event.roomId === where.roomId && event.version > where.version.gt
        );

        return orderBy.version === 'asc' ? rows : rows.reverse();
      })
    },
    $transaction: jest.fn((callback) => callback(prisma)),
    getEvents: () => events
  };

  return prisma;
}

describe('BoardService', () => {
  it('applies create, update, and delete events while incrementing board version', async () => {
    const prisma = createPrismaMock(createBoardState('room-a', 0));
    const service = new BoardService(prisma as unknown as PrismaService);

    const created = await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-1',
      eventType: 'object:create',
      baseVersion: 0,
      payload: {
        object: {
          id: 'object-1',
          type: 'rectangle',
          x: 10,
          y: 20,
          props: {
            width: 100,
            height: 50
          }
        }
      }
    });

    expect(created.version).toBe(1);
    expect(created.snapshot.objects['object-1']).toMatchObject({
      id: 'object-1',
      roomId: 'room-a',
      type: 'rectangle',
      x: 10,
      y: 20,
      version: 1,
      createdBy: 'user-1',
      updatedBy: 'user-1',
      deleted: false,
      props: {
        width: 100,
        height: 50
      }
    });

    const updated = await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-2',
      eventType: 'object:update',
      baseVersion: 1,
      payload: {
        objectId: 'object-1',
        patch: {
          x: 40,
          props: {
            color: 'red'
          }
        }
      }
    });

    expect(updated.version).toBe(2);
    expect(updated.snapshot.objects['object-1']).toMatchObject({
      x: 40,
      y: 20,
      version: 2,
      updatedBy: 'user-2',
      props: {
        width: 100,
        height: 50,
        color: 'red'
      }
    });

    const deleted = await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-1',
      eventType: 'object:delete',
      baseVersion: 2,
      payload: {
        objectId: 'object-1'
      }
    });

    expect(deleted.version).toBe(3);
    expect(deleted.snapshot.objects['object-1']).toMatchObject({
      deleted: true,
      version: 3,
      updatedBy: 'user-1'
    });
    expect(prisma.getEvents().map((event) => event.version)).toEqual([1, 2, 3]);
    expect(prisma.boardState.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          version: 3
        })
      })
    );
  });

  it('persists the accepted event payload', async () => {
    const prisma = createPrismaMock(createBoardState('room-a', 0));
    const service = new BoardService(prisma as unknown as PrismaService);
    const payload = {
      object: {
        id: 'object-1',
        type: 'circle' as const,
        x: 4,
        y: 5,
        props: {
          radius: 10
        }
      }
    };

    await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-1',
      eventType: 'object:create',
      payload
    });

    expect(prisma.boardEvent.create).toHaveBeenCalledWith({
      data: {
        roomId: 'room-a',
        version: 1,
        eventType: 'object:create',
        payloadJson: {
          schemaVersion: 1,
          eventType: 'object:create',
          payload
        },
        actorId: 'user-1'
      }
    });
  });

  it('loads the latest board snapshot', async () => {
    const snapshot: BoardSnapshot = {
      objects: {
        'object-1': {
          id: 'object-1',
          roomId: 'room-a',
          type: 'text',
          x: 1,
          y: 2,
          rotation: 0,
          version: 1,
          createdBy: 'user-1',
          updatedBy: 'user-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deleted: false,
          props: {
            text: 'Alpha'
          }
        }
      }
    };
    const prisma = createPrismaMock(createBoardState('room-a', 7, snapshot));
    const service = new BoardService(prisma as unknown as PrismaService);

    await expect(service.getBoardState('room-a')).resolves.toEqual({
      roomId: 'room-a',
      version: 7,
      snapshot
    });
  });

  it('returns delta events for recent reconnect versions', async () => {
    const prisma = createPrismaMock(createBoardState('room-a', 3));
    const service = new BoardService(prisma as unknown as PrismaService);

    await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-1',
      eventType: 'object:create',
      payload: {
        object: {
          id: 'object-1',
          type: 'rectangle',
          x: 10,
          y: 20
        }
      }
    });
    await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-2',
      eventType: 'object:update',
      payload: {
        objectId: 'object-1',
        patch: {
          x: 30
        }
      }
    });

    await expect(service.getReconnectSync('room-a', 4)).resolves.toMatchObject({
      syncMode: 'delta',
      currentVersion: 5,
      missedEvents: [
        {
          roomId: 'room-a',
          version: 5,
          eventType: 'object:update',
          actorId: 'user-2'
        }
      ]
    });
    expect(prisma.boardEvent.findMany).toHaveBeenCalledWith({
      where: {
        roomId: 'room-a',
        version: {
          gt: 4
        }
      },
      orderBy: {
        version: 'asc'
      }
    });
  });

  it('returns a snapshot for old reconnect versions', async () => {
    const snapshot: BoardSnapshot = {
      objects: {
        'object-1': {
          id: 'object-1',
          roomId: 'room-a',
          type: 'circle',
          x: 3,
          y: 4,
          rotation: 0,
          version: 1,
          createdBy: 'user-1',
          updatedBy: 'user-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deleted: false,
          props: {
            radius: 8
          }
        }
      }
    };
    const prisma = createPrismaMock(createBoardState('room-a', 80, snapshot));
    const service = new BoardService(prisma as unknown as PrismaService);

    await expect(service.getReconnectSync('room-a', 10)).resolves.toEqual({
      syncMode: 'snapshot',
      snapshot,
      currentVersion: 80
    });
    expect(prisma.boardEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects stale client base versions', async () => {
    const prisma = createPrismaMock(createBoardState('room-a', 2));
    const service = new BoardService(prisma as unknown as PrismaService);

    await expect(
      service.applyBoardEvent({
        roomId: 'room-a',
        actorId: 'user-1',
        eventType: 'object:create',
        baseVersion: 1,
        payload: {
          object: {
            id: 'object-1',
            type: 'line',
            x: 1,
            y: 2
          }
        }
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.boardEvent.create).not.toHaveBeenCalled();
  });

  it('auto-merges stale object updates when missed events changed different fields', async () => {
    const prisma = createPrismaMock(createBoardState('room-a', 0));
    const service = new BoardService(prisma as unknown as PrismaService);

    await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-1',
      eventType: 'object:create',
      baseVersion: 0,
      payload: {
        object: {
          id: 'object-1',
          type: 'rectangle',
          x: 10,
          y: 20,
          props: {
            color: 'blue',
            width: 100
          }
        }
      }
    });

    await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-2',
      eventType: 'object:update',
      baseVersion: 1,
      payload: {
        objectId: 'object-1',
        expectedVersion: 1,
        patch: {
          props: {
            color: 'red'
          }
        }
      }
    });

    const merged = await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-3',
      eventType: 'object:update',
      baseVersion: 1,
      payload: {
        objectId: 'object-1',
        expectedVersion: 1,
        patch: {
          x: 44
        }
      }
    });

    expect(merged.version).toBe(3);
    expect(merged.payload).toEqual({
      objectId: 'object-1',
      expectedVersion: undefined,
      patch: {
        x: 44
      }
    });
    expect(merged.snapshot.objects['object-1']).toMatchObject({
      x: 44,
      version: 3,
      props: {
        color: 'red',
        width: 100
      }
    });
  });

  it('rejects stale object updates when missed events changed the same field', async () => {
    const prisma = createPrismaMock(createBoardState('room-a', 0));
    const service = new BoardService(prisma as unknown as PrismaService);

    await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-1',
      eventType: 'object:create',
      baseVersion: 0,
      payload: {
        object: {
          id: 'text-1',
          type: 'text',
          x: 10,
          y: 20,
          props: {
            text: 'Alpha'
          }
        }
      }
    });

    await service.applyBoardEvent({
      roomId: 'room-a',
      actorId: 'user-2',
      eventType: 'object:update',
      baseVersion: 1,
      payload: {
        objectId: 'text-1',
        expectedVersion: 1,
        patch: {
          props: {
            text: 'Bravo'
          }
        }
      }
    });

    const rejectedUpdate = service.applyBoardEvent({
        roomId: 'room-a',
        actorId: 'user-3',
        eventType: 'object:update',
        baseVersion: 1,
        payload: {
          objectId: 'text-1',
          expectedVersion: 1,
          patch: {
            props: {
              text: 'Charlie'
            }
          }
        }
      });

    await expect(rejectedUpdate).rejects.toBeInstanceOf(BoardConflictException);
    await expect(rejectedUpdate).rejects.toMatchObject({
      details: expect.objectContaining({
        objectId: 'text-1',
        conflictingFields: ['props.text']
      })
    });
    expect(prisma.boardEvent.create).toHaveBeenCalledTimes(2);
  });

  it('rejects update and delete events with stale object versions', () => {
    const service = new BoardService(createPrismaMock() as unknown as PrismaService);
    const snapshot: BoardSnapshot = {
      objects: {
        'object-1': {
          id: 'object-1',
          roomId: 'room-a',
          type: 'rectangle',
          x: 10,
          y: 20,
          rotation: 0,
          version: 3,
          createdBy: 'user-1',
          updatedBy: 'user-2',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deleted: false,
          props: {
            width: 100,
            height: 50
          }
        }
      }
    };

    expect(() =>
      service.applyEventToSnapshot(snapshot, {
        roomId: 'room-a',
        actorId: 'user-1',
        eventType: 'object:update',
        payload: {
          objectId: 'object-1',
          expectedVersion: 2,
          patch: {
            x: 1
          }
        }
      })
    ).toThrow(ConflictException);

    expect(() =>
      service.applyEventToSnapshot(snapshot, {
        roomId: 'room-a',
        actorId: 'user-1',
        eventType: 'object:delete',
        payload: {
          objectId: 'object-1',
          expectedVersion: 2
        }
      })
    ).toThrow(ConflictException);
  });

  it('rejects updates and deletes for missing objects', () => {
    const prisma = createPrismaMock(createBoardState('room-a', 0));
    const service = new BoardService(prisma as unknown as PrismaService);

    expect(() =>
      service.applyEventToSnapshot(
        {
          objects: {}
        },
        {
          roomId: 'room-a',
          actorId: 'user-1',
          eventType: 'object:update',
          payload: {
            objectId: 'missing-object',
            patch: {
              x: 1
            }
          }
        }
      )
    ).toThrow(NotFoundException);

    expect(() =>
      service.applyEventToSnapshot(
        {
          objects: {}
        },
        {
          roomId: 'room-a',
          actorId: 'user-1',
          eventType: 'object:delete',
          payload: {
            objectId: 'missing-object'
          }
        }
      )
    ).toThrow(NotFoundException);
  });
});
