import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApplyBoardEventInput, BoardSnapshot } from '../board/board.service';
import { BoardService } from '../board/board.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateVersionTagDto } from './dto/create-version-tag.dto';

const RECENT_EVENT_LIMIT = 50;

type VersionEventResponse = {
  id: string;
  roomId: string;
  version: number;
  eventType: string;
  payload: unknown;
  actorId: string;
  createdAt: Date;
};

type VersionTagResponse = {
  id: string;
  roomId: string;
  version: number;
  label: string;
  createdAt: Date;
};

export type VersionHistoryResponse = {
  roomId: string;
  currentVersion: number;
  events: VersionEventResponse[];
  tags: VersionTagResponse[];
};

export type VersionDetailResponse = {
  roomId: string;
  currentVersion: number;
  version: number;
  event: VersionEventResponse | null;
  tags: VersionTagResponse[];
};

@Injectable()
export class VersionHistoryService {
  constructor(
    private readonly boardService: BoardService,
    private readonly prisma: PrismaService
  ) {}

  async listVersions(roomId: string): Promise<VersionHistoryResponse> {
    const currentVersion = await this.getCurrentVersion(roomId);
    const [events, tags] = await Promise.all([
      this.prisma.boardEvent.findMany({
        where: {
          roomId
        },
        orderBy: {
          version: 'desc'
        },
        take: RECENT_EVENT_LIMIT
      }),
      this.prisma.versionTag.findMany({
        where: {
          roomId
        },
        orderBy: [
          {
            version: 'desc'
          },
          {
            createdAt: 'desc'
          }
        ]
      })
    ]);

    return {
      roomId,
      currentVersion,
      events: events.map((event) => this.toVersionEventResponse(event)),
      tags: tags.map((tag) => this.toVersionTagResponse(tag))
    };
  }

  async createTag(roomId: string, dto: CreateVersionTagDto): Promise<VersionTagResponse> {
    const currentVersion = await this.getCurrentVersion(roomId);
    const label = dto.label.trim();

    if (!label) {
      throw new BadRequestException('label is required');
    }

    if (dto.version > currentVersion) {
      throw new BadRequestException('Version is newer than the current board version');
    }

    try {
      const tag = await this.prisma.versionTag.create({
        data: {
          roomId,
          version: dto.version,
          label
        }
      });

      return this.toVersionTagResponse(tag);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Version tag already exists');
      }

      throw error;
    }
  }

  async getVersion(roomId: string, version: number): Promise<VersionDetailResponse> {
    if (!Number.isInteger(version) || version < 0) {
      throw new BadRequestException('version must be a non-negative integer');
    }

    const currentVersion = await this.getCurrentVersion(roomId);

    if (version > currentVersion) {
      throw new NotFoundException('Version not found');
    }

    const [event, tags] = await Promise.all([
      this.prisma.boardEvent.findUnique({
        where: {
          roomId_version: {
            roomId,
            version
          }
        }
      }),
      this.prisma.versionTag.findMany({
        where: {
          roomId,
          version
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
    ]);

    if (version > 0 && !event) {
      throw new NotFoundException('Version not found');
    }

    return {
      roomId,
      currentVersion,
      version,
      event: event ? this.toVersionEventResponse(event) : null,
      tags: tags.map((tag) => this.toVersionTagResponse(tag))
    };
  }

  async restoreVersion(
    roomId: string,
    targetVersion: number,
    actorId: string
  ): Promise<{ roomId: string; version: number; restoredFromVersion: number }> {
    // Replay events up to targetVersion to reconstruct the snapshot properly
    const events = await this.prisma.boardEvent.findMany({
      where: { roomId, version: { lte: targetVersion } },
      orderBy: { version: 'asc' }
    });

    if (events.length === 0 && targetVersion > 0) {
      throw new NotFoundException('Target version not found');
    }

    // Use BoardService.applyEventToSnapshot to properly reconstruct BoardObject entries
    let snapshot: BoardSnapshot = { objects: {} };
    for (const event of events) {
      const input: ApplyBoardEventInput = {
        roomId: event.roomId,
        actorId: event.actorId,
        eventType: event.eventType as ApplyBoardEventInput['eventType'],
        payload: event.payloadJson as ApplyBoardEventInput['payload']
      };
      try {
        snapshot = this.boardService.applyEventToSnapshot(snapshot, input, event.createdAt);
      } catch {
        // Skip events that can't be applied (e.g., update on deleted object)
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const boardState = await tx.boardState.findUnique({
        where: { roomId },
        select: { version: true }
      });

      if (!boardState) {
        throw new NotFoundException('Board state not found');
      }

      const currentVersion = boardState.version;

      if (targetVersion > currentVersion) {
        throw new NotFoundException('Target version not found');
      }

      const nextVersion = currentVersion + 1;

      await tx.boardEvent.create({
        data: {
          roomId,
          version: nextVersion,
          eventType: 'history.restore',
          payloadJson: {
            fromVersion: currentVersion,
            targetVersion,
            restoredSnapshot: snapshot
          } as unknown as Prisma.InputJsonValue,
          actorId
        }
      });

      await tx.boardState.update({
        where: { roomId },
        data: {
          version: nextVersion,
          snapshotJson: snapshot as unknown as Prisma.InputJsonValue
        }
      });

      return { version: nextVersion };
    });

    return { roomId, version: result.version, restoredFromVersion: targetVersion };
  }

  private async getCurrentVersion(roomId: string): Promise<number> {
    const boardState = await this.prisma.boardState.findUnique({
      where: {
        roomId
      },
      select: {
        version: true
      }
    });

    if (!boardState) {
      throw new NotFoundException('Board state not found');
    }

    return boardState.version;
  }

  private toVersionEventResponse(event: {
    id: string;
    roomId: string;
    version: number;
    eventType: string;
    payloadJson: unknown;
    actorId: string;
    createdAt: Date;
  }): VersionEventResponse {
    return {
      id: event.id,
      roomId: event.roomId,
      version: event.version,
      eventType: event.eventType,
      payload: event.payloadJson,
      actorId: event.actorId,
      createdAt: event.createdAt
    };
  }

  private toVersionTagResponse(tag: {
    id: string;
    roomId: string;
    version: number;
    label: string;
    createdAt: Date;
  }): VersionTagResponse {
    return {
      id: tag.id,
      roomId: tag.roomId,
      version: tag.version,
      label: tag.label,
      createdAt: tag.createdAt
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
