# Auditoría de Seguridad — Copigrafica Sierra Backend

**Fecha:** 2026-09-01
**Alcance:** backend NestJS (`copi-factus-back`), frontend React/Vite (`copi-factus-front`), Supabase (PG + Auth + Storage).
**Destino de despliegue:** Vercel Hobby ($0) + Supabase.

---

## Hallazgos y estado

### 1. Manejo de secretos — OK
- `.env` incluido en `.gitignore` y **no** trackeado. Solo `package-lock.json`/código commiteados.
- `.env.example` documenta valores placeholder; **no** contiene claves reales.
- En Vercel/GitHub los secretos se inyectan como variables de entorno (nunca en el repositorio).
- `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_SECRET_KEY` solo viven en el backend (nunca en el frontend).

### 2. Autenticación y autorización — OK
- Login: bcrypt contra `profiles.password_hash`; JWT firmado con `JWT_SECRET` (fail-fast si es débil, ≥16 chars).
- `JwtAuthGuard` + `RolesGuard` aplicados por controlador; roles `ADMIN | FACTURADOR | CONSULTA`.
- (Verificado en `invoice-uploads.controller.ts`, patrón replicado en el resto de módulos.)
- Sesión por token en localStorage del frontend; el servidor nunca expone `password_hash`.

### 3. RLS / Supabase (trabajo previo verificado) — OK
- 21/21 tablas con RLS habilitado; `anon` denegado (404/forbidden).
- Policies `authenticated_all` en tablas de negocio; `profiles` con SELECT por columnas **excluyendo** `password_hash` y UPDATE solo `auth.uid() = auth_id`.
- Event trigger mantiene RLS activo en tablas nuevas.
- El backend usa Prisma con rol `postgres` (superuser), por lo que **no** depende de RLS para autorizar: la seguridad de negocio vive en los guards de la API. RLS es la capa de contención de Supabase frente a accesos directos/anon.

### 4. Storage de PDFs — Nuevo (verificado en tarea Storage)
- Bucket `invoice-pdfs` **privado** (creado con `ensure:storage`; `public: false`).
- Subida: URL firmada (`createSignedUploadUrl`) emitida solo a usuarios autenticados (guards); el PUT directo no pasa por la API.
- Descarga: signed read URL con expiración de 1h (`createSignedUrl`).
- El nombre del archivo se sanitiza (`/[^\w.\-() ]/g → '_'`); el `storagePath` se valida en el DTO (`presign` y `register`).
- Se elimina el filesystem local del backend (último uso de `fs` en el servicio de uploads); el histograma de PDFs históricos migra con `migrate:uploads --apply`.

### 5. Headers HTTP — Mejorado
- **Nuevo:** `app.use(helmet())` en `createNestApp()` (protección XSS/clickjacking/MIME sniffing, HSTS, etc.).
- CORS: lista explícita de orígenes (`CORS_ORIGIN`), `credentials: true`.

### 6. Rate limiting — OK
- `ThrottlerGuard` global: 100 req/min por IP (configurado en `app.module.ts`).

### 7. Validación de entrada — OK
- `ValidationPipe` global con `whitelist: true` + `forbidNonWhitelisted: true` + DTOs con `class-validator`.
- `transform: true` con `enableImplicitConversion: false` (sin coerción inesperada de tipos).

### 8. Vulnerabilidades de dependencias — RIESGO ACEPTADO (documentado)
- Frontend: **0 vulnerabilidades**.
- Backend: **4 high**, todas a través de la cadena Prisma CLI:
  - `deepmerge-ts <8.0.0` — GHSA-ggr8-5vv4-36mx (stack exhaustion al mergear grafos recursivos) vía `@prisma/config`.
  - `mysql2 <3.22.0` — GHSA-3f6p-5ww8-9rcr (downgrade de auth → fuga de credenciales) vía driver MySQL de Prisma.
- Mitigaciones:
  - El backend usa **PostgreSQL**; el código de `mysql2` nunca se ejecuta.
  - `deepmerge-ts` solo procesa archivos de configuración de Prisma (sin entrada de usuarios HTTP).
  - El "fix" automático (`npm audit fix --force`) **degrada a Prisma 6.19.3** (breaking) — rechazado.
  - Acción: revisar en el siguiente ciclo de actualización de Prisma ≥8 (profundizaré en el roadmap).

### 9. Riesgos pendientes / plan
1. **Alta:** `public_inquiries` no existe aún en la DB remota (drift con schema). Genera error solo si se consulta. → Aplicar tras próximo `prisma db push` y RLS (`20260901000002_public_inquiries_rls.sql`).
2. **Media:** el frontend mantiene `src/lib/supabase.ts` sin uso (cliente muerto). → Eliminar en limpieza (fuera de alcance de esta iteración).
3. **Media:** JWT en `localStorage` (vulnerable a XSS). Mitigación actual: helmet + reportContentSecurityPolicy no aplicada en SPA; el frontend es estático sin markup de terceros. Considerar `httpOnly` cookies si la experiencia lo permite (requiere refactor de auth).
4. **Media:** una sola Function serverless expuesta a nivel API: sin CDN/WAF avanzado en plan Hobby. Mitigación: rate limit + guards + body limit.
5. **Baja:** algunos chunk del frontend >500kB (aviso de Vite). Afecta rendimiento, no seguridad.

---

## Herramientas / comandos usados
- `npm audit --omit=dev` (backend y frontend) — ver §8.
- Inspección estática (código) de auth, guards, CORS, validación, storage.
- Verificación RLS previa contra la DB remota.

**Resultado:** sin vulnerabilidades explotables a través de la API desplegada. Riesgo aceptado documentado en §8 y pendientes en §9.