import { ConfigService } from '@nestjs/config';
import { FactusAuthService } from './factus-auth.service';

const makeEnv = (token: string) => ({
  FACTUS_URL: 'https://api-sandbox.factus.com.co',
  FACTUS_CLIENT_ID: 'cid',
  FACTUS_CLIENT_SECRET: 'csec',
  FACTUS_USERNAME: 'u@mail.com',
  FACTUS_PASSWORD: 'pass',
});

describe('FactusAuthService', () => {
  let service: FactusAuthService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const build = (fetchImpl: typeof globalThis.fetch) => {
    globalThis.fetch = fetchImpl;
    const cfg = new ConfigService(makeEnv('x'));
    service = new FactusAuthService(cfg as any);
  };

  it('obtiene token con grant_type=password', async () => {
    const calls: string[] = [];
    build((async (url: any, init: any) => {
      calls.push(String(url));
      expect(String(init.body)).toContain('grant_type=password');
      return new Response(
        JSON.stringify({
          access_token: 'ACCESS',
          refresh_token: 'REFRESH',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch);

    const token = await service.getAccessToken();
    expect(token).toBe('ACCESS');
    expect(calls.length).toBe(1);
  });

  it('usa cache cuando el token no está por vencer', async () => {
    let hit = 0;
    build((async (url: any, init: any) => {
      hit += 1;
      return new Response(
        JSON.stringify({
          access_token: 'ACCESS',
          refresh_token: 'REFRESH',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch);

    await service.getAccessToken();
    const second = await service.getAccessToken();
    expect(second).toBe('ACCESS');
    expect(hit).toBe(1);
  });

  it('forceRefresh usa refresh_token cuando hay token previo', async () => {
    build((async (url: any, init: any) => {
      const body = String(init.body ?? '');
      const grant = /grant_type=password/.test(body)
        ? 'password'
        : 'refresh_token';
      return new Response(
        JSON.stringify({
          access_token: `ACCESS_${grant}`,
          refresh_token: 'REFRESH2',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch);

    await service.getAccessToken(); // password
    const refreshed = await service.forceRefresh(); // refresh_token
    expect(refreshed).toBe('ACCESS_refresh_token');
  });

  it('isConfigured es false sin credenciales', () => {
    const cfg = new ConfigService({});
    service = new FactusAuthService(cfg as any);
    expect(service.isConfigured()).toBe(false);
  });
});