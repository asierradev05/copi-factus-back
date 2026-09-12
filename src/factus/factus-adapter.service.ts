import { Injectable } from '@nestjs/common';
import { FactusAuthService } from './factus-auth.service';
import { FactusApiException } from './factus-api.exception';

type Method = 'GET' | 'POST' | 'PUT';
type Params = Record<string, string | number | boolean | undefined>;

@Injectable()
export class FactusAdapterService {
  constructor(private readonly auth: FactusAuthService) {}

  getCompanies(): Promise<any> {
    return this.request('GET', '/v2/companies');
  }
  updateCompany(payload: unknown): Promise<any> {
    return this.request('PUT', '/v2/companies', payload);
  }
  getSubscriptions(): Promise<any> {
    return this.request('GET', '/v2/subscriptions');
  }
  createNumberingRange(payload: unknown): Promise<any> {
    return this.request('POST', '/v2/numbering-ranges', payload);
  }
  listNumberingRanges(params?: Params): Promise<any> {
    return this.request('GET', '/v2/numbering-ranges', undefined, params);
  }
  getDianRanges(): Promise<any> {
    return this.request('GET', '/v2/numbering-ranges/dian');
  }
  toggleNumberingRange(id: number, active: boolean): Promise<any> {
    return this.request('POST', '/v2/numbering-ranges/toggle', { id, active });
  }
  updateNumberingRange(id: number, payload: unknown): Promise<any> {
    return this.request('PUT', `/v2/numbering-ranges/${id}`, payload);
  }
  getAcquirer(query: Params): Promise<any> {
    return this.request('GET', '/v2/dian/acquirer', undefined, query);
  }
  validateBills(payload: unknown): Promise<any> {
    return this.request('POST', '/v2/bills/validate', payload);
  }
  listBills(params?: Params): Promise<any> {
    return this.request('GET', '/v2/bills', undefined, params);
  }
  async downloadBillPdf(number: string): Promise<Buffer> {
    const token = await this.auth.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const res = await globalThis.fetch(
      `${this.auth.getBaseUrl()}/v2/bills/${encodeURIComponent(number)}/download-pdf`,
      { method: 'GET', headers },
    );
    if (!res.ok) {
      throw await this.buildError(res, await res.text());
    }
    return Buffer.from(await res.arrayBuffer());
  }
  async downloadBillXml(number: string): Promise<string> {
    const token = await this.auth.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const res = await globalThis.fetch(
      `${this.auth.getBaseUrl()}/v2/bills/${encodeURIComponent(number)}/download-xml`,
      { method: 'GET', headers },
    );
    if (!res.ok) {
      throw await this.buildError(res, await res.text());
    }
    const raw = await res.text();
    try {
      const parsed = JSON.parse(raw);
      const b64 = parsed?.data?.xml_base_64_encoded;
      if (typeof b64 === 'string') {
        return Buffer.from(b64, 'base64').toString('utf-8');
      }
    } catch {
      return raw;
    }
    return raw;
  }

  private async request(
    method: Method,
    path: string,
    body?: unknown,
    params?: Params,
    retried = false,
  ): Promise<any> {
    const token = await this.auth.getAccessToken();
    const url = this.buildUrl(path, params);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await globalThis.fetch(url, init);
    const text = await res.text();
    if (res.status === 401 && !retried) {
      await this.auth.forceRefresh();
      return this.request(method, path, body, params, true);
    }
    if (!res.ok) {
      throw await this.buildError(res, text);
    }
    return text ? JSON.parse(text) : null;
  }

  private buildUrl(path: string, params?: Params): string {
    const url = new URL(`${this.auth.getBaseUrl()}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '')
          url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private buildError(res: Response, text: string): FactusApiException {
    let raw: any = null;
    let messages: string[] = [];
    try {
      raw = JSON.parse(text);
      const data = raw?.data;
      if (data && typeof data.errors === 'object' && data.errors !== null) {
        messages = Object.entries(data.errors as Record<string, string[]>).flatMap(
          ([field, errs]) =>
            Array.isArray(errs)
              ? errs.map((e) => `${field}: ${e}`)
              : [`${field}: ${String(errs)}`],
        );
      } else if (Array.isArray(raw?.error)) {
        messages = raw.error
          .map((e: { message?: string }) => e?.message ?? '')
          .filter(Boolean);
      } else if (raw?.message) {
        messages = [raw.message];
      }
    } catch {
      messages = [text || `HTTP ${res.status}`];
    }
    return new FactusApiException(res.status, messages, raw);
  }
}
