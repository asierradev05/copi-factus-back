import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import { AuthUser } from '../common/types/auth-user.type';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  fullName: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const supabaseSecret = configService.get<string>('SUPABASE_JWT_SECRET');
    const jwtSecret =
      configService.get<string>('JWT_SECRET') ?? 'dev-jwt-secret';

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: supabaseSecret ?? jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    let user = await this.authService.validateUser(payload.sub);
    if (!user) {
      user = await this.authService.validateUserByAuthId(payload.sub);
    }
    if (!user) {
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }
    return user;
  }
}
