# Auditoría de Seguridad — Copigrafica Sierra Backend (strix/ecc)

**Fecha:** 2026-09-12
**Método:** Revisión manual guiada por skills de strix (`api-security-testing`, `web-app-penetration-testing`, `find-security-vulnerabilities-in-code`, `owasp-top-10-testing`) + corrección con skills de ECC. White-box (repo `D:\copiFactus\backend`) + black-box (API `https://copifactushb-back.vercel.app`).
**Contexto:** complementa `docs/security-audit-2026-09-01.md`. Baseline: HEAD `064ae18`, 85/85 tests.

---

## Resumen

| Severidad | Corregidos | Aceptados / NA |
|---|---|---|
| Media | 3 | 2 |
| Baja | 0 | 2 |

Todos los hallazgos corregidos incluyen test que falla sin el fix (TDD). Estado final: **101/101 tests**, `npm run build` OK.

---

## Hallazgos

### H1 (Media) — Path traversal en `presignUpload` de adjuntos
- **CWE-22** | `src/document-attachments/document-attachments.service.ts`
- **Vector:** `attachments/${entityType}/${entityId}/${Date.now()}-${fileName}` construida con input del cliente sin validar. `entityType`, `entityId` y `fileName` podían incluir `/` y `..`, permitiendo escribir/solicitar objetos fuera del prefijo `attachments/` del bucket privado.
- **PoC (pre-fix):** `POST /api/attachments/presign` con `{ "fileName": "factura.pdf", "entityType": "../../etc", "entityId": "uuid" }` → `path: "attachments/../../etc/uuid/..."`.
- **Fix:** validar `entityType` contra enum `AttachmentEntityType`, `entityId` contra `/^[A-Za-z0-9-]+$/`, y sanear `fileName` (reemplaza `[^\w.\-() ]` → `_`, colapsa `..`, máx 255 chars). Con esto, `create()` también valida que `storagePath` pertenezca al bucket `document-attachments` y no contenga `..`.
- **Tests:** `src/document-attachments/document-attachments.service.spec.ts` (8 tests: enum, id, fileName, bucket, traversal).
- **Commit:** `2918de8` (con H2, spec, reporte y plan).

### H2 (Media) — `create` de invoice-uploads aceptaba bucket arbitrario
- **CWE-22/CWE-434 | `src/invoice-uploads/invoice-uploads.service.ts`**
- **Vector:** `const [bucket, ...rest] = dto.storagePath.split('/')` aceptaba cualquier bucket, permitiendo a un ADMIN/FACTURADOR leer objetos de otros buckets del proyecto (p. ej. `document-attachments`, privado) vía `downloadAsBuffer`.
- **PoC (pre-fix):** `POST /api/invoice-uploads` con `storagePath: "document-attachments/x.pdf"` → descarga objeto del bucket de adjuntos.
- **Fix:** exigir `bucket === 'invoice-pdfs'` y rechazar `..` en el objectPath.
- **Tests:** `src/invoice-uploads/invoice-uploads.service.spec.ts` (3 tests: bucket distinto, traversal, path válido).
- **Commit:** `2918de8`.

### H6 (Media) — Adjuntos sin límite de tamaño ni formato (presign + create)
- **CWE-434 | `src/document-attachments/document-attachments.service.ts`**
- **Vector:** `presignUpload` y `create` aceptaban cualquier fileName/archivo (`.exe`, `.html`, 5GB). La única defensa era el `accept` y un chequeo de 10MB en el navegador (`AttachmentZone.tsx`), que un cliente autenticado (FACTURADOR/ADMIN) puede saltar con la API directa.
- **PoC (pre-fix):** `POST /api/attachments/presign` con `fileName: "backdoor.exe"` → generaba URL firmada para subirlo; `create` registraba el adjunto sin validar tamaño/MIME.
- **Fix:** `assertFileAllowed()` en `presignUpload` y `create` — máx **10MB** (alineado al frontend), extensión en whitelist (`pdf, doc, docx, png, jpg, jpeg, gif, webp, bmp`) y MIME con prefijos permitidos (`application/pdf`, `application/msword`, `application/vnd...wordprocessingml.document`, `image/`).
- **Tests:** `src/document-attachments/document-attachments.service.spec.ts` (+4 tests: tamaño, extensión, MIME, presign; +1 caso feliz por extensión).
- **Commit:** `d76caf9`.

### H3 (Info/aceptado) — Configuración JWT dual-key
- `src/auth/jwt.strategy.ts:32`: `secretOrKey: supabaseSecret ?? jwtSecret`. `SUPABASE_JWT_SECRET` **no** está seteado en `.env`; con la config actual se verifica con `JWT_SECRET` (66 chars, fail-fast si débil, expira en `8h`). Riesgo solo si en el futuro se setea `SUPABASE_JWT_SECRET` distinto de `JWT_SECRET` (rompería auth). **Acción:** si se habilita Supabase Auth, alinear ambos o usar solo uno.

### H4 (Info/aceptado) — App single-tenant
- Sin `companyId`/`tenantId` por fila en `prisma/schema.prisma` → IDOR cross-tenant **no aplica**. La frontera real es rol-vs-rol cubierta por `JwtAuthGuard` + `RolesGuard` en todos los controllers (verificado). Registro para el roadmap multi-tenant.

### H5 (Info/aceptado) — JWT en localStorage del frontend
- Ya documentado en la auditoría previa (§9). Mantener helmet + CSP; considerar httpOnly cookies si se refactoriza auth.

---

## Verificaciones en verde (black-box)

- **Authz:** endpoints protegidos devuelven 401 sin token (invoices, dashboard).
- **Headers Helmet:** CSP estricta, HSTS (`max-age=31536000`), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, COOP/CORP `same-origin`, `Referrer-Policy: no-referrer`, `Server: Vercel` (sin versión).
- **Rate limit:** `POST /public-inquiries` throttle propio (5/min) → 429; Throttler global 100/min en `app.module.ts`.
- **Inyección SQL:** todos los `$queryRaw` son template literals parametrizados de Prisma (bind params, sin interpolación de strings de usuario).
- **XSS:** `renderBrandedEmail` aplica `escapeHtml` a todos los valores interpolados; tests de escape incluidos.
- **Mass assignment:** `ValidationPipe` global `whitelist + forbidNonWhitelisted`; DTOs con `class-validator`.
- **Secretos:** sin credenciales en repo; `sanitize()` excluye `passwordHash` de respuestas y audit.

## Revisión de acceso y hardening (2026-09-12, petición del usuario)

Los 8 puntos pedidos, verificados white-box + black-box:

| # | Punto | Veredicto |
|---|---|---|
| 1 | **IDOR** (cambiar id en URL y ver datos de otro) | No aplicable: app **single-tenant** (H4). Cambiar `:id` muestra datos del mismo tenant, permitido por diseño según rol. Rutas de datos personales (`/users`, `/audit`) son ADMIN-only. 22/22 controllers con `JwtAuthGuard`+`RolesGuard`. |
| 2 | **CORS** | **Restringido** (no acepta cualquier sitio). Probes black-box: `evil.example.com` sin ACAO; `copifactushb-front.vercel.app`, `localhost:5173`, `localhost:3000` permitidos. ⚠️ **Nota de config:** `www.copigraficassierra.com` **no** está en el allowlist desplegado → al activar la web pública el POST `/public-inquiries` desde el navegador quedaría bloqueado por CORS. Ajustar `CORS_ORIGIN` en Vercel antes. |
| 3 | **Archivos** (tamaño/formato) | Invoice-uploads OK (máx 50MB, fuerza `.pdf`). Adjuntos sin límite → **H6 corregido** (10MB + whitelist ext/MIME). |
| 4 | **Queries a DB** | 4 `$queryRaw` todos parametrizados con bind params de Prisma (invoice-number.util.ts, document-sequence.util.ts, invoices.service.ts, resolutions.service.ts). Sin SQLi. |
| 5 | **Tokens en localStorage** | JWT en `localStorage` (`copigrafica_token`) + usuario (`copigrafica_user`). Exfiltrable ante XSS; sin `dangerouslySetInnerHTML` en `src/`, CSP estricta, expiración 8h, `/auth/me` revalida rol en servidor. Aceptado (H5) — considerar httpOnly cookies si hay refactor de auth. |
| 6 | **Permisos frontend** | Sólo UX (nav filtrada + `WriteRoute` por `canWrite`); el enforcement real está en backend (`RolesGuard`). Correcto — nunca confiar en lo que pinta el front. |
| 7 | **Rate limiting** | Throttler global 100/min + `public-inquiries` 5/60s (verificado 429 en prod). `login` sin throttle específico (sólo global, IP) → fuerza bruta acotada a ~100/min con bcrypt. Mejora opcional: `@Throttle` 10/min en login. |
| 8 | **Validación en servidor** | `ValidationPipe` global `whitelist+forbidNonWhitelisted+transform`; DTOs con `class-validator`; `HttpExceptionFilter` mapea errores Prisma a 4xx (sin leak de detalles). |

**Acciones pendientes (no-bloqueantes):**
- Al activar la web pública: incluir `www.copigraficassierra.com`/`copigraficassierra.com` en `CORS_ORIGIN` de Vercel.
- Mejora opcional: throttle específico en `/auth/login`.
- Mejora futura: mover token de sesión a httpOnly cookie (requiere refactor de auth).

---

## Notas de operación
- Se crearon 5 `public_inquiries` de prueba (`t@t.co`) durante el chequeo de rate limit contra producción. **Limpiar en la DB antes de producción** (o descartar).
- Lint no es gate (deuda pre-existente ~742 errores); no se expandió.

## Comandos usados
- Instalación skills: `npx skills add usestrix/strix -y --global --agent '*'` (9 skills) y `npx skills add affaan-m/ecc -y --global --agent '*'` (ECC completo, instalado en `~\.agents\skills\`).
- Tests: `npx jest` (101/101), build: `npm run build`.
- Commits: `2918de8` (H1, H2, reporte, plan), `c3d07e4` (docs plan), `d76caf9` (H6). Deploys de Vercel verificados en verde.