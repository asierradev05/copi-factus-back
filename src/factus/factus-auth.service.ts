import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

@Injectable()
export class FactusAuthService {
  private readonly logger = new Logger(FactusAuthService.name);
  private token: TokenPair | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return [
      'FACTUS_URL',
      'FACTUS_CLIENT_ID',
      'FACTUS_CLIENT_SECRET',
      'FACTUS_USERNAME',
      'FACTUS_PASSWORD',
    ].every((key) => Boolean(this.config.get<string>(key)));
  }

  getBaseUrl(): string {
    return (
      this.config.get<string>('FACTUS_URL') ??
      'https://api-sandbox.factus.com.co'
    ).replace(/\/$/, '');
  }

  async getAccessToken(): Promise<string> {
    if (
      this.token &&
      this.token.expiresAt.getTime() - 10 * 60 * 1000 > Date.now()
    ) {
      return this.token.accessToken;
    }
    if (!this.inFlight) {
      this.inFlight = this.refreshTokenInternal().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  forceRefresh(): Promise<string> {
    return this.refreshTokenInternal();
  }

  private async refreshTokenInternal(): Promise<string> {
    const grant = this.token ? 'refresh_token' : 'password';
    const params: Record<string, string> = {
      grant_type: grant,
      client_id: this.config.get<string>('FACTUS_CLIENT_ID') ?? '',
      client_secret: this.config.get<string>('FACTUS_CLIENT_SECRET') ?? '',
    };
    if (grant === 'refresh_token' && this.token) {
      params.refresh_token = this.token.refreshToken;
    } else {
      params.username = this.config.get<string>('FACTUS_USERNAME') ?? '';
      params.password = this.config.get<string>('FACTUS_PASSWORD') ?? '';
    }

    const res = await globalThis.fetch(`${this.getBaseUrl()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(
        `Factus: error de autenticación (${res.status}) ${JSON.stringify(json)}`,
      );
    }
    this.token = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? this.token?.refreshToken ?? '',
      expiresAt: new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000),
    };
    return this.token.accessToken;
  }
}