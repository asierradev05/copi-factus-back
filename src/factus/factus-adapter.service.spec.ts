import { FactusAuthService } from './factus-auth.service';
import { FactusAdapterService } from './factus-adapter.service';
import { FactusApiException } from './factus-api.exception';

describe('FactusAdapterService', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const authOf = (token: string) =>
    ({
      getAccessToken: async () => token,
      forceRefresh: async () => token,
      getBaseUrl: () => 'https://api-sandbox.factus.com.co',
    }) as unknown as FactusAuthService;

  it('GET companies envía Authorization y devuelve data', async () => {
    globalThis.fetch = (async (url: any, init: any) => {
      expect(String(init.headers.Authorization)).toContain('Bearer ACCESS');
      return new Response(JSON.stringify({ data: [{ id: 1 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const svc = new FactusAdapterService(authOf('ACCESS'));
    const result = await svc.getCompanies();
    expect(result.data).toEqual([{ id: 1 }]);
  });

  it('reintenta una vez tras 401 con forceRefresh', async () => {
    let calls = 0;
    globalThis.fetch = (async (url: any, init: any) => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ status_code: 401 }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const svc = new FactusAdapterService(authOf('ACCESS'));
    const result = await svc.listBills();
    expect(result.data).toEqual([]);
    expect(calls).toBe(2);
  });

  it('lanza FactusApiException con mensajes concatenados ante 422', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status_code: 422,
          error: [
            { context: 'customer', message: 'dv inválido' },
            { context: 'items', message: 'impuesto no permitido' },
          ],
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );

    const svc = new FactusAdapterService(authOf('ACCESS'));
    await expect(svc.validateBills([{}])).rejects.toThrow(FactusApiException);
    await expect(svc.validateBills([{}])).rejects.toThrow(
      /dv inválido; impuesto no permitido/,
    );
  });

  it('marca already exists', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status_code: 422,
          error: [
            { message: 'bill with reference_code: REF123 already exists' },
          ],
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );

    const svc = new FactusAdapterService(authOf('ACCESS'));
    await expect(svc.validateBills([{}])).rejects.toMatchObject({
      statusCode: 422,
    });
    await expect(
      svc.validateBills([{}]).catch((e: FactusApiException) => {
        expect(e.isAlreadyExists()).toBe(true);
      }),
    ).resolves.toBeUndefined();
  });
});
