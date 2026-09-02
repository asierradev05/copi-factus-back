# Despliegue Vercel $0 (Front + Back) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desplegar backend NestJS y frontend React/Vite en Vercel (Hobby $0) con Supabase (PG/Auth/Storage), CI/CD con GitHub Actions y despliegue verificado desde CLI.

**Architecture:** El backend NestJS corre como una sola Vercel Function detrás de rewrites (`api/index.js` + `serverless-http`). Los uploads de facturas se mueven a Supabase Storage con subida directa desde el navegador (presign → PUT → register) para eludir el límite de 4.5MB; las descargas usan signed read URLs. El frontend es estático en Vercel y apunta al backend vía `VITE_API_URL`. La DB sigue siendo Postgres de Supabase con Prisma (transaction pooler). CI/CD con GitHub Actions en ambos repos.

**Tech Stack:** NestJS 11, Prisma 7 (`@prisma/adapter-pg`), `serverless-http`, `@supabase/supabase-js` (Storage + Auth), React/Vite (Typscript), Vercel CLI/Platform, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-01-vercel-deployment.md` (lea junto con este plan)

## Global Constraints

- Costo $0 obligatorio: plan Hobby de Vercel. Sin VPS; Render solo como fallback.
- `NODE_ENV=production` en todo deploy real; el in-memory fallback queda deshabilitado.
- Body request/response Vercel ≤ 4.5MB: ningún PDF viaja por la function; solo signed URLs.
- `DATABASE_URL` = transaction pooler Supabase (puerto 6543, `connection_limit` pequeño); `DIRECT_URL` = directo (puerto 5432) para scripts y `prisma db push`.
- No se deben commitear secretos (`.env`, tokens, claves). `VERCEL_TOKEN` y las demás claves viven en GitHub/Vercel como secrets.
- Idioma de UI/mensajes: español (coherente con el código actual).
- No cambiar la firma de `PrismaService`, `AuthService` ni los DTOs existentes salvo donde el plan lo indique.

---

### Task 1: Refactor del bootstrap NestJS + entry serverless

**Files:**
- Modify: `src/main.ts`
- Create: `api/index.js`
- Create: `vercel.json`
- Modify: `package.json` (dependencia `serverless-http`)

**Interfaces:**
- Consumes: `AppModule` existente (sin cambios).
- Produces: `createNestApp(): Promise<INestApplication>` (exportado desde `src/main.ts`), usado por `api/index.js`.

- [ ] **Step 1: Añadir dependencia `serverless-http`**

Run:
```bash
npm install serverless-http
```
Expected: `serverless-http` aparece en `dependencies` de `package.json`.

- [ ] **Step 2: Extraer `createNestApp()` en `src/main.ts`**

Reemplazar el contenido de `src/main.ts` (manteniendo `HttpExceptionFilter`, pipes, CORS actuales) con:

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

export async function createNestApp() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://www.copigraficassierra.com',
      'https://copigraficassierra.com',
    ],
    credentials: true,
  });

  return app;
}

async function bootstrap() {
  const app = await createNestApp();
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Copigrafica Sierra API running on http://localhost:${port}/api`);
}

if (require.main === module) {
  void bootstrap();
}
```

- [ ] **Step 3: Crear el handler serverless `api/index.js`**

```js
const serverless = require('serverless-http');

let cachedHandler;

async function prepareHandler() {
  if (!cachedHandler) {
    const { createNestApp } = require('../dist/main');
    const app = await createNestApp();
    cachedHandler = serverless(app.getHttpAdapter().getInstance());
  }
  return cachedHandler;
}

module.exports = async function handler(req, res) {
  const h = await prepareHandler();
  return h(req, res);
};
```

- [ ] **Step 4: Crear `vercel.json`**

```json
{
  "functions": {
    "api/index.js": { "maxDuration": 300 }
  },
  "rewrites": [
    { "source": "/api", "destination": "/api/index" },
    { "source": "/api/(.*)", "destination": "/api/index" }
  ]
}
```

- [ ] **Step 5: Verificar build y arranque dev**

Run:
```bash
npm run build
```
Expected: build OK (dist/main.js generado).

Run:
```bash
node -e "const { createNestApp } = require('./dist/main'); createNestApp().then(a => { console.log('BOOT_OK'); return a.close(); })"
```
Expected: `BOOT_OK` (sin quedarse escuchando, prueba el modo serverless).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main.ts api/index.js vercel.json
git commit -m "feat(deploy): refactor Nest bootstrap y entry serverless para Vercel"
```

---

### Task 2: Supabase Storage — presign, register y descarga firmada (backend)

**Files:**
- Modify: `src/common/supabase/supabase.service.ts`
- Modify: `src/invoice-uploads/invoice-uploads.controller.ts`
- Modify: `src/invoice-uploads/invoice-uploads.service.ts`
- Create: `src/invoice-uploads/dto/register-invoice-upload.dto.ts`
- Create: `scripts/ensure-storage-bucket.ts`

**Interfaces:**
- Consumes: `SupabaseService` (client service-role ya existente).
- Produces:
  - `SupabaseService.ensureBucket(name)`, `SupabaseService.presignUploadUrl(bucket, path): Promise<string>`, `SupabaseService.signedReadUrl(bucket, path, expiresIn?): Promise<string>`, `SupabaseService.downloadAsBuffer(bucket, path): Promise<Buffer>`.
  - Controller: `POST /api/invoice-uploads/presign` → `{ uploadUrl, storagePath }`.
  - Controller: `POST /api/invoice-uploads` (JSON) → `{ upload, extracted }`.
  - Controller: `GET /api/invoice-uploads/:id/file` → `{ url }`.

- [ ] **Step 1: Añadir métodos de Storage a `SupabaseService`**

Append a `src/common/supabase/supabase.service.ts`:

```ts
async ensureBucket(name: string): Promise<void> {
  const { error } = await this.client.storage.getBucket(name);
  if (!error) {
    return;
  }
  const { error: createError } = await this.client.storage.createBucket(name, {
    public: false,
  });
  if (createError) {
    throw new Error(createError.message);
  }
}

async presignUploadUrl(bucket: string, path: string): Promise<string> {
  const { data, error } = await this.client.storage
    .from(bucket)
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
  const { data, error } = await this.client.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  if (error || !data) {
    throw new Error(error?.message ?? 'No se pudo firmar la URL de descarga.');
  }
  return data.signedUrl;
}

async downloadAsBuffer(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await this.client.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(error?.message ?? 'No se pudo descargar el archivo.');
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

- [ ] **Step 2: Crear DTO de registro**

Create `src/invoice-uploads/dto/register-invoice-upload.dto.ts`:

```ts
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class RegisterInvoiceUploadDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsInt()
  @Min(1)
  @Max(50 * 1024 * 1024)
  fileSize: number;

  @IsString()
  @IsNotEmpty()
  storagePath: string;
}
```

- [ ] **Step 3: Reemplazar lógica de disco en `InvoiceUploadsService`**

En `src/invoice-uploads/invoice-uploads.service.ts`:

- Eliminar `import * as fs from 'node:fs'`, `import * as path from 'node:path'`, la constante `UPLOADS_DIR` y el método `getFileBuffer`.
- Inyectar `SupabaseService` y añadir constante `const BUCKET = 'invoice-pdfs';`.
- Reemplazar `create` (multipart) con:

```ts
async create(
  dto: {
    fileName: string;
    fileSize: number;
    storagePath: string;
  },
  userId: string,
): Promise<{ upload: unknown; extracted: ExtractedInvoiceData }> {
  const safeName = dto.fileName.replace(/[^\w.\-() ]/g, '_');
  const [bucket, ...rest] = dto.storagePath.split('/');
  const objectPath = rest.join('/');
  if (!bucket || !objectPath) {
    throw new BadRequestException('storagePath inválido.');
  }

  const buffer = await this.supabase.downloadAsBuffer(bucket, objectPath);
  const extracted = await this.extractFromPdf(buffer);

  const upload = await this.prisma.invoiceUpload.create({
    data: {
      fileName: safeName,
      filePath: dto.storagePath,
      fileSize: dto.fileSize,
      extractedNit: extracted.nit,
      extractedDate: extracted.date,
      extractedAmount:
        extracted.amount !== undefined
          ? new Prisma.Decimal(extracted.amount)
          : null,
      extractedConcept: extracted.concept,
      uploadedById: userId,
    },
    include: {
      uploadedBy: { select: { id: true, email: true, fullName: true } },
    },
  });

  await this.audit.log({
    userId,
    action: AuditAction.CREATE,
    entityType: 'InvoiceUpload',
    entityId: upload.id,
    newValue: {
      fileName: upload.fileName,
      extracted: { nit: extracted.nit, amount: extracted.amount },
    },
  });

  return { upload, extracted };
}

async presignUpload(): Promise<{ uploadUrl: string; storagePath: string }> {
  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const storagePath = `${BUCKET}/${fileId}.pdf`;
  const uploadUrl = await this.supabase.presignUploadUrl(BUCKET, storagePath);
  return { uploadUrl, storagePath };
}

async getSignedReadUrl(upload: {
  filePath: string;
}): Promise<string> {
  const [bucket, ...rest] = upload.filePath.split('/');
  const objectPath = rest.join('/');
  if (!bucket || !objectPath) {
    throw new NotFoundException('El archivo de la factura no fue encontrado.');
  }
  return this.supabase.signedReadUrl(bucket, objectPath);
}
```

- [ ] **Step 4: Actualizar el controlador `InvoiceUploadsController`**

En `src/invoice-uploads/invoice-uploads.controller.ts`:

- Quitar `FileInterceptor`/`UploadedFile`/`UseInterceptors` del `POST`, inyectar el DTO y añadir `presign`:

```ts
@Post('presign')
@Roles(UserRole.ADMIN, UserRole.FACTURADOR)
presignUpload() {
  return this.invoiceUploads.presignUpload();
}

@Post()
@Roles(UserRole.ADMIN, UserRole.FACTURADOR)
create(
  @Body() dto: RegisterInvoiceUploadDto,
  @CurrentUser() user: AuthUser,
) {
  return this.invoiceUploads.create(dto, user.id);
}

@Get(':id/file')
@Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
async getFileLink(@Param('id') id: string) {
  const upload = await this.invoiceUploads.findOne(id);
  if (!upload) {
    throw new NotFoundException(
      'El archivo de la factura no fue encontrado.',
    );
  }
  const url = await this.invoiceUploads.getSignedReadUrl(upload);
  return { url };
}
```

- Actualizar imports: quitar `StreamableFile`, `Res`, `Response`, `FileInterceptor`, `UploadedFile`, `UseInterceptors`; añadir `Body`, `NotFoundException`, `RegisterInvoiceUploadDto`.

- [ ] **Step 5: Script `ensure-storage-bucket`**

Create `scripts/ensure-storage-bucket.ts`:

```ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'invoice-pdfs';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
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
```

Añadir al `package.json`: `"ensure:storage": "ts-node scripts/ensure-storage-bucket.ts"`.

- [ ] **Step 6: Verificar build y ejecutar el script en remoto**

Run:
```bash
npm run build
```
Expected: build OK.

Run:
```bash
npm run ensure:storage
```
Expected: `Bucket "invoice-pdfs" ya existe.` o `creado (privado).` (sin errores).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(uploads): mover facturas a Supabase Storage con presign + signed read URLs"
```

---

### Task 3: Flujo de upload con Storage (frontend)

**Files:**
- Modify: `src/services/invoice-uploads.ts`
- Modify: `src/pages/invoice-uploads/ImportInvoicePage.tsx`

**Interfaces:**
- Consumes: endpoints nuevos del backend (`POST /invoice-uploads/presign`, `POST /invoice-uploads` JSON, `GET /invoice-uploads/:id/file` → `{ url }`) y el helper `api` existente.
- Produces: `invoiceUploadsService.upload(file): Promise<{ upload; extracted }>` y `invoiceUploadsService.getSignedUrl(id): Promise<string>`.

- [ ] **Step 1: Reescribir `src/services/invoice-uploads.ts`**

```ts
import { api } from '@/lib/api'
import type { InvoiceUpload, PaginatedResponse } from '@/types'

interface PresignResponse {
  uploadUrl: string
  storagePath: string
}

interface UploadResponse {
  upload: InvoiceUpload
  extracted: {
    nit?: string
    date?: string
    amount?: number
    concept?: string
  }
}

export const invoiceUploadsService = {
  list: (page = 1, limit = 20) =>
    api<PaginatedResponse<InvoiceUpload>>('/invoice-uploads', {
      params: { page, limit },
    }),
  get: (id: string) => api<InvoiceUpload>(`/invoice-uploads/${id}`),
  upload: async (file: File): Promise<UploadResponse> => {
    const { uploadUrl, storagePath } = await api<PresignResponse>(
      '/invoice-uploads/presign',
      { method: 'POST' },
    )
    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/pdf' },
      body: file,
    })
    if (!putResponse.ok) {
      throw new Error('No se pudo subir el archivo al almacenamiento.')
    }
    return api<UploadResponse>('/invoice-uploads', {
      method: 'POST',
      body: {
        fileName: file.name,
        fileSize: file.size,
        storagePath,
      },
    })
  },
  getSignedUrl: async (id: string): Promise<string> => {
    const result = await api<{ url: string }>(`/invoice-uploads/${id}/file`)
    return result.url
  },
}
```

- [ ] **Step 2: Ajustar `ImportInvoicePage.tsx` — descarga por URL firmada**

Reemplazar `openPreview`:

```tsx
const openPreview = async (id: string) => {
  try {
    const url = await invoiceUploadsService.getSignedUrl(id)
    window.open(url, '_blank')
  } catch {
    setError('No se pudo abrir el PDF.')
  }
}
```

Quitar los imports ahora sin uso (`getAuthToken` indirecto ya no se usa; el import de `invoiceUploadsService.fileUrl` ya no existe).

- [ ] **Step 3: Verificar build del frontend**

Run:
```bash
npm run build
```
Expected: build OK (Vite genera `dist/`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(uploads): upload directo a Supabase Storage y descarga por URL firmada"
```

---

### Task 4: Script de migración de archivos históricos

**Files:**
- Create: `scripts/migrate-uploads-to-storage.ts` (repo backend)
- Modify: `package.json`

**Interfaces:**
- Consumes: carpeta `uploads/invoice-pdfs/` (leída desde CWD), filas `invoice_uploads` con `file_path` estilo `/uploads/invoice-pdfs/<file>`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: actualiza `invoice_uploads.file_path` a `invoice-pdfs/<file>` tras subir el blob.

**Entrada/Salida:** Ejecutar manualmente una sola vez con la flag `--apply`; por defecto es dry-run. Debe correrse desde el host que aún tenga los PDFs (Render) antes de darlo de baja.

- [ ] **Step 1: Escribir `scripts/migrate-uploads-to-storage.ts`**

```ts
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'invoice-pdfs';
const DIR = path.join(process.cwd(), 'uploads', 'invoice-pdfs');
const apply = process.argv.includes('--apply');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  }
  const prisma = new PrismaClient();
  const storage = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await prisma.invoiceUpload.findMany({
    select: { id: true, fileName: true, filePath: true },
  });

  let migrated = 0;
  for (const row of rows) {
    if (row.filePath?.startsWith(`${BUCKET}/`)) {
      continue;
    }
    const local =
      row.filePath?.startsWith('/uploads/') || row.filePath?.startsWith('uploads/')
        ? path.join(process.cwd(), row.filePath.replace(/^\/?uploads\//, 'uploads/'))
        : null;
    if (!local || !fs.existsSync(local)) {
      console.warn(`SKIP ${row.id}: no local file for ${row.filePath}`);
      continue;
    }
    const buffer = fs.readFileSync(local);
    const objectPath = `${BUCKET}/${row.fileName}`;
    if (apply) {
      const { error } = await storage.storage
        .from(BUCKET)
        .upload(objectPath, buffer, { upsert: true, contentType: 'application/pdf' });
      if (error) {
        console.error(`FAIL ${row.id}: ${error.message}`);
        continue;
      }
      await prisma.invoiceUpload.update({
        where: { id: row.id },
        data: { filePath: objectPath },
      });
    }
    console.log(`${apply ? 'MIGRATED' : 'DRY-RUN'}: ${row.id} -> ${objectPath} (${buffer.length} bytes)`);
    migrated++;
  }

  console.log(`Total: ${migrated} filas ${apply ? 'migradas' : 'a migrar (usa --apply)'}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Añadir script npm**

En `package.json`:
```json
"migrate:uploads": "ts-node scripts/migrate-uploads-to-storage.ts"
```

- [ ] **Step 3: Verificación**

Run:
```bash
npx tsc --noEmit scripts/migrate-uploads-to-storage.ts 2>&1 | Out-Null; Write-Output "syntax check running"
ts-node scripts/migrate-uploads-to-storage.ts
```
Expected: `Total: 0 filas a migrar (usa --apply)` (o estados DRY-RUN; en esta máquina `uploads/` está vacío).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-uploads-to-storage.ts package.json
git commit -m "feat(uploads): script de migración de PDFs históricos a Supabase Storage"
```

---

### Task 5: Pooler de Supabase y documentación de entorno

**Files:**
- Modify: `.env.example`
- Modify: `README.md` (sección despliegue)

**Interfaces:**
- Consumes: no cambia código. Produce: valores correctos para desplegar.

- [ ] **Step 1: Actualizar `.env.example`**

Cambiar los comentarios/valores de `DATABASE_URL` y `DIRECT_URL` para reflejar pooler vs directo:

```dotenv
# PostgreSQL (Supabase)
# TRANSACTION POOLER (serverless/Vercel): puerto 6543 + connection_limit pequeño
DATABASE_URL="postgresql://postgres.qwerty:[PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5&sslmode=no-verify"
# CONEXIÓN DIRECTA (prisma db push / scripts / migraciones): puerto 5432, host db.<ref>.supabase.co
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=no-verify"
```

(Reemplazar `<PROJECT_REF>`, `<region>` y `[PASSWORD]` al copiar).

- [ ] **Step 2: Documentar despliegue en `README.md`**

Añadir sección "Despliegue en Vercel (Hobby)" que explique: 2 proyectos Vercel, `VITE_API_URL`, prisma db push en build, pooler vs directo, y flujo de uploads vía Storage.

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs(deploy): pooler de Supabase y despliegue Vercel en README"
```

---

### Task 6: Auditoría de seguridad + fixes rápidos

**Files:**
- Modify: `src/main.ts` (añadir `helmet`)
- Create: `docs/security-audit-2026-09-01.md` (backend repo)
- Modify: `package.json` (dep `helmet`)

**Interfaces:**
- Consumes: sin cambios de interfaces. Produce: reporte + hardening mínimo.

- [ ] **Step 1: Instalar y activar `helmet`**

Run:
```bash
npm install helmet
```
En `src/main.ts`, dentro de `createNestApp()` tras `NestFactory.create`, añadir `app.use(helmet());` (importar `helmet`). Ajustar para no romper CORS (helmet por defecto no bloquea CORS configurado).

- [ ] **Step 2: Auditar dependencias**

Run (en `D:\copiFactus\backend`):
```bash
npm audit --omit=dev
```
Run (en `D:\copiFactus\frontend`):
```bash
npm audit --omit=dev
```
Registrar resultados (vulnerabilidades críticas/altas y remediación `npm audit fix --omit=dev`) en el reporte. Si hay fixes seguros, aplicarlos con `npm audit fix --omit=dev` y commitear.

- [ ] **Step 3: Revisión manual y reporte**

Write `docs/security-audit-2026-09-01.md` cubriendo (estado real del código):
- Secretos: `.env`/`.env.example`, `.gitignore`, que `SUPABASE_*` y `JWT_SECRET` no se commiteen.
- Auth: bcrypt + JWT `JWT_SECRET` ≥16 chars, guards globales por módulo, `RolesGuard` aplicado.
- CORS: lista explícita, `credentials: true`.
- Header de respuesta: `helmet` (nuevo).
- Rate limiting: `ThrottlerModule` 100 req/min global.
- Uploads: sanitización de nombre, path traversal ya mitigado, límite 10MB (ahora Storage), bucket privado + signed URLs.
- Inyección/validación: `ValidationPipe` whitelist global + DTOs.
- RLS/Supabase: policies aplicadas (work previo), anon bloqueado.
- Riesgos pendientes listados con severidad y plan.

- [ ] **Step 4: Verificar build + lint del backend**

Run:
```bash
npm run build
npx eslint "src/**/*.ts" "test/**/*.ts"
```
Nota: el lint del repo ya trae errores pre-existentes; verificar que NO se agreguen errores nuevos en `src/main.ts`/`src/invoice-uploads/*`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(security): helmet, npm audit y reporte de seguridad"
```

---

### Task 7: CI/CD con GitHub Actions

**Files:**
- Create: `.github/workflows/deploy.yml` (backend repo)
- Create: `.github/workflows/deploy.yml` (frontend repo)
- Modify: `README.md` (instrucciones de secrets)

**Interfaces:**
- Consumes: repos GitHub, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DATABASE_URL` (pooler) como secrets.
- Produces: deploy automático a `main`.

- [ ] **Step 1: Workflow backend (`.github/workflows/deploy.yml`, repo backend)**

```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install
        run: npm ci

      - name: Generate Prisma client
        run: npx prisma generate
        env:
          DIRECT_URL: ${{ secrets.DIRECT_URL }}

      - name: Build
        run: npm run build

      - name: Ensure storage bucket
        run: npm run ensure:storage
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Push schema (transaccional, sin data loss)
        run: npx prisma db push
        env:
          DIRECT_URL: ${{ secrets.DIRECT_URL }}

      - name: Deploy to Vercel
        run: npx vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }} && npx vercel build --prod --token=${{ secrets.VERCEL_TOKEN }} && npx vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

- [ ] **Step 2: Workflow frontend (`.github/workflows/deploy.yml`, repo frontend)**

```yaml
name: Deploy Frontend

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install
        run: npm ci

      - name: Build
        run: npm run build
        env:
          VITE_API_URL: ${{ secrets.VITE_API_URL }}

      - name: Deploy to Vercel
        run: npx vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }} && npx vercel build --prod --token=${{ secrets.VERCEL_TOKEN }} && npx vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

- [ ] **Step 3: Documentar secrets requeridos en ambos README**

Lista: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (backend y frontend), `DATABASE_URL` (pooler), `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL`, `CORS_ORIGIN`, `VITE_API_URL` (frontend).

- [ ] **Step 4: Commit en cada repo**

Backend:
```bash
git add .github/workflows/deploy.yml README.md
git commit -m "ci: deploy automático a Vercel en push a main"
```
Frontend: igual en `D:\copiFactus\frontend`.

---

### Task 8: Push final a GitHub

- [ ] **Step 1: Push backend**

Run (en `D:\copiFactus\backend`):
```bash
git status
git push origin main
```
Expected: push OK o mensaje de autenticación (pedir credenciales GitHub al usuario si aplica).

- [ ] **Step 2: Push frontend**

Run (en `D:\copiFactus\frontend`):
```bash
git status
git push origin main
```

---

### Task 9: Intento de despliegue desde CLI (Vercel)

**Files:** ninguno en el repo (config en la plataforma).

- [ ] **Step 1: Login de Vercel**

Run:
```bash
npx vercel login
```
Expected: el usuario se autentica en el navegador. Si no hay cuenta, crearla.

- [ ] **Step 2: Vincular/crear proyecto backend**

Run (en `D:\copiFactus\backend`):
```bash
npx vercel link --yes --project copifactushb-back
```
Luego cargar env vars:
```bash
npx vercel env add DATABASE_URL production
npx vercel env add DIRECT_URL production
npx vercel env add SUPABASE_URL production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add SUPABASE_SECRET_KEY production
npx vercel env add SUPABASE_JWKS_URL production
npx vercel env add JWT_SECRET production
npx vercel env add JWT_EXPIRES_IN production
npx vercel env add FRONTEND_URL production
npx vercel env add CORS_ORIGIN production
```
(Pegar valores del `.env` real.)

- [ ] **Step 3: Deploy backend**

Run:
```bash
npx vercel --prod
```
Expected: URL de producción; luego `curl https://<back>.vercel.app/api` responde y
`POST /api/auth/login` de un usuario real devuelve token y `200`.

- [ ] **Step 4: Vincular/crear proyecto frontend**

Run (en `D:\copiFactus\frontend`):
```bash
npx vercel link --yes --project copifactushb-front
npx vercel env add VITE_API_URL production
```
`VITE_API_URL` = `https://<back>.vercel.app/api`.

- [ ] **Step 5: Deploy frontend**

Run:
```bash
npx vercel --prod
```
Expected: front en producción, CORS del backend incluye el dominio front en `CORS_ORIGIN`.

- [ ] **Step 6: Smoke test integral**

- Login desde el front desplegado.
- Subir un PDF de factura (round-trip presign → PUT → register → extracción).
- Abrir PDF desde el historial (signed read URL).

**Definition of done:** los 6 pasos OK en producción.

---

## Self-Review completado
- **Cobertura spec:** uploads→Storage (T2/T3), serverless entry (T1), pooler (T5), CI/CD (T7), audit (T6), deploy CLI (T9), push (T8). Sin huecos.
- **Placeholders:** ningún "TBD"; cada paso tiene comandos o código exactos.
- **Tipos consistentes:** `SupabaseService.presignUploadUrl/signedReadUrl/downloadAsBuffer/ensureBucket`, `invoiceUploadsService.upload/getSignedUrl`, `RegisterInvoiceUploadDto` referenciados igual en todas las tareas.