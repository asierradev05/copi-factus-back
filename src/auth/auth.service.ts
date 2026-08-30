import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user.type';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken: string; user: AuthUser }> {
    const email = dto.email.toLowerCase().trim();
    const profile = await this.prisma.profile.findUnique({
      where: { email },
    });

    if (!profile || !profile.isActive) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const isValidPassword = await this.validatePassword(
      dto.password,
      profile.passwordHash,
    );
    if (!isValidPassword) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const user: AuthUser = {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      fullName: profile.fullName,
    };

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    await this.auditService
      .log({
        userId: user.id,
        action: AuditAction.LOGIN,
        entityType: 'Profile',
        entityId: user.id,
        newValue: { email: user.email },
      })
      .catch(() => {});

    return { accessToken, user };
  }

  private async validatePassword(
    password: string,
    hash: string | null,
  ): Promise<boolean> {
    if (!hash) {
      return false;
    }
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async validateUser(userId: string): Promise<AuthUser | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });

    if (profile && profile.isActive) {
      return this.toAuthUser(profile);
    }

    return null;
  }

  async validateUserByAuthId(authId: string): Promise<AuthUser | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { authId },
    });

    if (!profile || !profile.isActive) {
      return null;
    }

    return this.toAuthUser(profile);
  }

  private toAuthUser(profile: {
    id: string;
    email: string;
    role: AuthUser['role'];
    fullName: string;
  }): AuthUser {
    return {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      fullName: profile.fullName,
    };
  }
}
