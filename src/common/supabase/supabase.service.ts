import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private client: SupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_SECRET_KEY') ??
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (supabaseUrl && supabaseKey) {
      this.client = createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }
  }

  getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error(
        'Supabase no está configurado. Agrega SUPABASE_URL y SUPABASE_SECRET_KEY.',
      );
    }

    return this.client;
  }

  ensureBucket(name: string): Promise<void> {
    return this.getClient().storage.getBucket(name).then(({ error }) => {
      if (!error) {
        return;
      }
      return this.getClient()
        .storage.createBucket(name, { public: false })
        .then(({ error: createError }) => {
          if (createError) {
            throw new Error(createError.message);
          }
        });
    });
  }

  async presignUploadUrl(bucket: string, path: string): Promise<string> {
    const { data, error } = await this.getClient()
      .storage.from(bucket)
      .createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(error?.message ?? 'No se pudo firmar la URL de subida.');
    }
    return data.signedUrl;
  }

  async signedReadUrl(
    bucket: string,
    path: string,
    expiresIn = 3600,
  ): Promise<string> {
    const { data, error } = await this.getClient()
      .storage.from(bucket)
      .createSignedUrl(path, expiresIn);
    if (error || !data) {
      throw new Error(error?.message ?? 'No se pudo firmar la URL de descarga.');
    }
    return data.signedUrl;
  }

  async downloadAsBuffer(bucket: string, path: string): Promise<Buffer> {
    const { data, error } = await this.getClient()
      .storage.from(bucket)
      .download(path);
    if (error || !data) {
      throw new Error(error?.message ?? 'No se pudo descargar el archivo.');
    }
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  isConfigured(): boolean {
    return this.client !== null;
  }
}
