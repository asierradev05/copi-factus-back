import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user.type';
import { LoginDto } from './dto/login.dto';

const DEV_PROFILES: Record<
  string,
  { id: string; email: string; fullName: string; role: AuthUser['role'] }
> = {
  'admin@copigrafica.dev': {
    id: 'dev-admin-id',
    email: 'admin@copigrafica.dev',
    fullName: 'Administrador DEV',
    role: 'ADMIN',
  },
  'facturador@copigrafica.dev': {
    id: 'dev-facturador-id',
    email: 'facturador@copigrafica.dev',
    fullName: 'Facturador DEV',
    role: 'FACTURADOR',
  },
  'consulta@copigrafica.dev': {
    id: 'dev-consulta-id',
    email: 'consulta@copigrafica.dev',
    fullName: 'Consulta DEV',
    role: 'CONSULTA',
  },
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken: string; user: AuthUser }> {
    const email = dto.email.toLowerCase().trim();
    let profile: {
      id: string;
      email: string;
      role: AuthUser['role'];
      fullName: string;
      isActive: boolean;
    } | null = null;

    try {
      profile = await this.prisma.profile.findUnique({
        where: { email },
      });
    } catch {
      profile = DEV_PROFILES[email]
        ? { ...DEV_PROFILES[email], isActive: true }
        : null;
    }

    if (!profile && DEV_PROFILES[email]) {
      profile = { ...DEV_PROFILES[email], isActive: true };
    }

    if (!profile || !profile.isActive) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const isValidPassword = this.validateDevPassword(dto.email, dto.password);
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

  validateDevPassword(email: string, password: string): boolean {
    const devUsersJson = this.configService.get<string>('DEV_USERS');
    if (devUsersJson) {
      try {
        const devUsers = JSON.parse(devUsersJson) as Record<string, string>;
        const normalizedEmail = email.toLowerCase().trim();
        if (devUsers[normalizedEmail] !== undefined) {
          return devUsers[normalizedEmail] === password;
        }
      } catch {
        // fall through to default dev password
      }
    }

    const defaultPassword =
      this.configService.get<string>('DEV_PASSWORD') ?? 'Admin123!';
    return password === defaultPassword;
  }

  async validateUser(userId: string): Promise<AuthUser | null> {
    try {
      const profile = await this.prisma.profile.findUnique({
        where: { id: userId },
      });

      if (profile && profile.isActive) {
        return this.toAuthUser(profile);
      }
    } catch {
      // fallback for dev mode
    }

    const devProfile = Object.values(DEV_PROFILES).find((p) => p.id === userId);
    if (devProfile) {
      return devProfile;
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
