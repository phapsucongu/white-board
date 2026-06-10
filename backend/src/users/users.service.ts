import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PublicUser = Pick<User, 'id' | 'email' | 'displayName' | 'createdAt' | 'updatedAt'>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: {
        email: this.normalizeEmail(email)
      }
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: {
        id
      }
    });
  }

  async findPublicById(id: string): Promise<PublicUser | null> {
    const user = await this.findById(id);

    return user ? this.toPublicUser(user) : null;
  }

  createUser(input: {
    email: string;
    passwordHash: string;
    displayName?: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: this.normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        displayName: input.displayName?.trim() || null
      }
    });
  }

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
