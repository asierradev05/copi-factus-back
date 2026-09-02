# Spec: Despliegue $0 en Vercel (front + back) con Supabase y CI/CD

**Fecha:** 2026-09-01
**Estado:** aprobado por el usuario (análisis de compatibilidad validado)

## Objetivo

Desplegar el backend NestJS y el frontend React/Vite en **Vercel (Hobby, $0)**, manteniendo
**Supabase** para PostgreSQL, Auth y Storage, con **CI/CD via GitHub Actions** para deploys
rápidos ante cambios. Sin VPS. Render/Railway solo como fallback si aparece una necesidad
técnica real de servidor persistente (no esperado: ver matriz de compatibilidad).

## Compatibilidad revisada (validada en código + docs de Vercel 2026)

- **Sin incompatibilidad real de "proceso persistente"**: el backend no tiene estado en
  memoria en producción (in-memory fallback solo dev), sin cron, sin WebSockets, sin
  child_process.
- **Único bloqueo funcional**: filesystem local para PDFs de facturas subidas
  (`invoice-uploads.service.ts` escribe en `uploads/invoice-pdfs/`). En serverless el disco es
  efímero.
- **Límite Vercel**: request/response body 4.5MB (todas las tier). El upload actual permite
  10MB → hay que subir directo desde el navegador a **Supabase Storage**.
- **Duración**: Hobby 300s (PDFs en memoria OK). **Memoria**: 2GB. **Bundle**: 250MB.
- PDFs generados (pdfmake) son en memoria (stream/adjunto email) → OK.
- Email SMTP (nodemailer) → OK. DIAN = cálculo local de CUFE → OK.
- Prisma → usar **transaction pooler** de Supabase (puerto 6543) con `connection_limit`
  pequeño; `DIRECT_URL` directo (puerto 5432) para scripts/migraciones.

## Decisiones de arquitectura

### Backend (NestJS → Vercel Function)
- **Entry serverless**: `api/index.ts` (raíz) que reutiliza el Nest app vía `serverless-http`;
  `vercel.json` con `rewrites: /(.*) -> /api/index` y `functions.maxDuration: 300`.
- Refactor de `main.ts`: extraer `createNestApp()` (pipes, filtro, CORS) exportable; mantener
  `bootstrap()` para dev local (`npm run start:dev`).
- Los endpoints siguen en `setGlobalPrefix('api')`.

### Invoice uploads → Supabase Storage (flujo nuevo)
1. Front pide **signed upload URL**: `POST /invoice-uploads/presign` (auth) →
   `{ uploadUrl, storagePath }`.
2. Front hace **PUT directo** del PDF a `uploadUrl` (nunca pasa por la función, elude el
   límite 4.5MB).
3. Front registra metadatos: `POST /invoice-uploads` (JSON) con `{ fileName, fileSize,
   storagePath }`.
4. Backend descarga el archivo desde Storage (service role), corre `extractFromPdf` (pdf-parse),
   guarda fila en `invoice_uploads` y devuelve `{ upload, extracted }`.
5. Descarga: `GET /invoice-uploads/:id/file` → 302 a **signed read URL** de Storage (elude el
   límite de response 4.5MB). El front abre esa URL.

Bucket sugerido: `invoice-pdfs` (privado; solo acceso via signed URLs).

### Migración de archivos históricos
Script `scripts/migrate-uploads-to-storage.ts`: lee `uploads/invoice-pdfs/` local (donde Render
tenía los PDFs) + filas de `invoice_uploads`, sube a Storage y actualiza `storage_path`.
**Ejecutar antes de dar de baja Render.**

### Frontend (Vite → Vercel)
- `VITE_API_URL` → URL de la función backend (`https://<proj>.vercel.app` en prod).
- `invoice-uploads.ts`: `upload()`, `presignUpload()`, `registerUpload()` y apertura de PDF por
  URL firmada (`window.open(url)`).
- `ImportInvoicePage.tsx`: orquesta presign → PUT → register; `openPreview` usa URL firmada.

### Seguridad
- Auditoría previa al deploy definitivo (npm audit + revisión manual) con fixes rápidos:
  añadir `helmet`, CORS estricto con dominios reales, revisar guards/roles, path traversal ya
  protegido, no exponer secretos.
- Reporte en `docs/security-audit-2026-09-01.md`.

### CI/CD (GitHub Actions, ambos repos, rama `main`)
- **backend/.github/workflows/deploy.yml**: `npm ci && prisma generate && npm run build` →
  `npx prisma db push` (producción, `DATABASE_URL`=pooler) → `vercel --prod` con
  `VERCEL_TOKEN` del secret.
- **frontend/.github/workflows/deploy.yml**: `npm ci && npm run build` → `vercel --prod`.
- Deploy manual actual (Render) queda documentado como fallback en el README.

### Despliegue (intento final, todo desde CLI)
1. `vercel login`.
2. `vercel link` (crear proyecto) en ambos repos.
3. Cargar env vars en los proyectos de Vercel (CLI) — sin comprometer secretos en el repo.
4. `vercel --prod` front y back; `VITE_API_URL` apuntando al back.
5. Smoke test: login real + subir un PDF (round-trip Storage) + ver descarga.

## Fuera de alcance (YAGNI)
- Event trigger de RLS adicional (ya existe), Supabase Auth como login principal, SSR,
  multi-tenant, alarmas/monitoreo, dominios personalizados.