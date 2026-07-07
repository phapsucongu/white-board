import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Comment } from '@prisma/client';
import { RoomRole } from '../permissions/room-role.enum';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCommentDto } from './dto/create-comment.dto';
import type { UpdateCommentDto } from './dto/update-comment.dto';

export type CommentResponse = {
  id: string;
  roomId: string;
  objectId: string | null;
  x: number | null;
  y: number | null;
  body: string;
  resolved: boolean;
  authorId: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(roomId: string): Promise<CommentResponse[]> {
    const comments = await this.prisma.comment.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' }
    });

    return comments.map((comment) => this.toResponse(comment));
  }

  async create(roomId: string, authorId: string, dto: CreateCommentDto): Promise<CommentResponse> {
    const hasCanvasPoint = typeof dto.x === 'number' && typeof dto.y === 'number';

    if (!dto.objectId && !hasCanvasPoint) {
      throw new NotFoundException('Comment target is required');
    }

    const comment = await this.prisma.comment.create({
      data: {
        roomId,
        authorId,
        objectId: dto.objectId,
        x: dto.x,
        y: dto.y,
        body: dto.body.trim()
      }
    });

    return this.toResponse(comment);
  }

  async update(
    roomId: string,
    commentId: string,
    actorId: string,
    actorRole: RoomRole,
    dto: UpdateCommentDto
  ): Promise<CommentResponse> {
    const existing = await this.getComment(roomId, commentId);
    this.assertCanModify(existing, actorId, actorRole);

    const comment = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        body: dto.body === undefined ? undefined : dto.body.trim(),
        resolved: dto.resolved
      }
    });

    return this.toResponse(comment);
  }

  async remove(
    roomId: string,
    commentId: string,
    actorId: string,
    actorRole: RoomRole
  ): Promise<{ success: true }> {
    const existing = await this.getComment(roomId, commentId);
    this.assertCanModify(existing, actorId, actorRole);

    await this.prisma.comment.delete({ where: { id: commentId } });

    return { success: true };
  }

  private async getComment(roomId: string, commentId: string): Promise<Comment> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, roomId }
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    return comment;
  }

  private assertCanModify(comment: Comment, actorId: string, actorRole: RoomRole): void {
    if (comment.authorId === actorId || actorRole === RoomRole.OWNER) {
      return;
    }

    throw new ForbiddenException('Only the author or room owner can modify this comment');
  }

  private toResponse(comment: Comment): CommentResponse {
    return {
      id: comment.id,
      roomId: comment.roomId,
      objectId: comment.objectId,
      x: comment.x,
      y: comment.y,
      body: comment.body,
      resolved: comment.resolved,
      authorId: comment.authorId,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString()
    };
  }
}
