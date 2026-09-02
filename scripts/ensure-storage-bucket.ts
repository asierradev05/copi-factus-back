import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'invoice-pdfs';

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
  if (!getError) {
    console.log(`Bucket "${BUCKET}" ya existe.`);
    return;
  }
  const { error: createError } = await client.storage.createBucket(BUCKET, {
    public: false,
  });
  if (createError) {
    throw new Error(createError.message);
  }
  console.log(`Bucket "${BUCKET}" creado (privado).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});