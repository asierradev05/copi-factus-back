import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'email-assets';

const ASSETS: { file: string; url: string; type: string }[] = [
  {
    file: 'logo-copigraficas.png',
    url: 'https://img.mailinblue.com/8176936/images/content_library/original/66fc5288dcfdf3b4d058e23f.png',
    type: 'image/png',
  },
  {
    file: 'banner-cabecera.jpeg',
    url: 'https://img.mailinblue.com/8176936/images/content_library/original/670999ca629b8be85a90379a.jpeg',
    type: 'image/jpeg',
  },
  {
    file: 'hero.png',
    url: 'https://img.mailinblue.com/8176936/images/content_library/original/6709942d3ffc64a293ec3087.png',
    type: 'image/png',
  },
  {
    file: 'bg-conocerte.png',
    url: 'https://img.mailinblue.com/8176936/images/content_library/original/670998c6629b8be85a903773.png',
    type: 'image/png',
  },
  {
    file: 'img-redondeada.png',
    url: 'https://img.mailinblue.com/8176936/images/content_library/original/67099d09629b8be85a903805.png',
    type: 'image/png',
  },
  {
    file: 'arte-pie.png',
    url: 'https://img.mailinblue.com/8176936/images/content_library/original/67099ae5629b8be85a9037c6.png',
    type: 'image/png',
  },
  {
    file: 'icon-impresion.png',
    url: 'https://img.mailinblue.com/8176936/images/content_library/original/6705b8b2157551302627486c.png',
    type: 'image/png',
  },
  {
    file: 'icon-promocionales.png',
    url: 'https://img.mailinblue.com/8176936/images/content_library/original/6705b9865797590c981cbdc3.png',
    type: 'image/png',
  },
  {
    file: 'icon-marketing.png',
    url: 'https://img.mailinblue.com/8176936/images/content_library/original/6705b9e55797590c981cbdce.png',
    type: 'image/png',
  },
  {
    file: 'social-facebook.png',
    url: 'https://creative-assets.mailinblue.com/editor/social-icons/rounded_colored/facebook_32px.png',
    type: 'image/png',
  },
  {
    file: 'social-whatsapp.png',
    url: 'https://creative-assets.mailinblue.com/editor/social-icons/rounded_colored/whatsapp_32px.png',
    type: 'image/png',
  },
  {
    file: 'social-website.png',
    url: 'https://creative-assets.mailinblue.com/editor/social-icons/rounded_colored/website_32px.png',
    type: 'image/png',
  },
];

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: getError } = await client.storage.getBucket(BUCKET);
  if (getError) {
    const { error: createError } = await client.storage.createBucket(BUCKET, {
      public: true,
    });
    if (createError) {
      throw new Error(createError.message);
    }
    console.log(`Bucket "${BUCKET}" creado (público).`);
  } else {
    const { error: updateError } = await client.storage.updateBucket(BUCKET, {
      public: true,
    });
    if (updateError) {
      throw new Error(updateError.message);
    }
    console.log(`Bucket "${BUCKET}" ya existía; ahora es público.`);
  }

  const base = `${url.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}`;
  for (const asset of ASSETS) {
    const bytes = await fetchBytes(asset.url);
    const { error } = await client.storage
      .from(BUCKET)
      .upload(asset.file, bytes, { contentType: asset.type, upsert: true });
    if (error) {
      throw new Error(`Subida ${asset.file}: ${error.message}`);
    }
    console.log(`${base}/${asset.file} (${bytes.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});