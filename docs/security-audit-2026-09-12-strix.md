# Auditoría de Seguridad — Copigrafica Sierra Backend (strix/ecc)

**Fecha:** 2026-09-12
**Método:** Revisión manual guiada por skills de strix (`api-security-testing`, `web-app-penetration-testing`, `find-security-vulnerabilities-in-code`, `owasp-top-10-testing`) + corrección con skills de ECC. White-box (repo `D:\copiFactus\backend`) + black-box (API `https://copifactushb-back.vercel.app`).
**Contexto:** complementa `docs/security-audit-2026-09-01.md`. Baseline: HEAD `064ae18`, 85/85 tests.

---

## Resumen

| Severidad | Corregidos | Aceptados / NA |
|---|---|---|
| Media | 2 | 2 |
| Baja | 0 | 2 |

Todos los hallazgos corregidos incluyen test que falla sin el fix (TDD). Estado final: **96/96 tests**, `npm run build` OK.

---

## Hallazgos

### H1 (Media) — Path traversal en `presignUpload` de adjuntos
- **CWE-22** | `src/document-attachments/document-attachments.service.ts`
- **Vector:** `attachments/${entityType}/${entityId}/${Date.now()}-${fileName}` construida con input del cliente sin validar. `entityType`, `entityId` y `fileName` podían incluir `/` y `..`, permitiendo escribir/solicitar objetos fuera del prefijo `attachments/` del bucket privado.
- **PoC (pre-fix):** `POST /api/attachments/presign` con `{ "fileName": "factura.pdf", "entityType": "../../etc", "entityId": "uuid" }` → `path: "attachments/../../etc/uuid/..."`.
- **Fix:** validar `entityType` contra enum `AttachmentEntityType`, `entityId` contra `/^[A-Za-z0-9-]+$/`, y sanear `fileName` (reemplaza `[^\w.\-() ]` → `_`, colapsa `..`, máx 255 chars). Con esto, `create()` también valida que `storagePath` pertenezca al bucket `document-attachments` y no contenga `..`.
- **Tests:** `src/document-attachments/document-attachments.service.spec.ts` (8 tests: enum, id, fileName, bucket, traversal).
- **Commit:** pendiente en la entrega.

### H2 (Media) — `create` de invoice-uploads aceptaba bucket arbitrario
- **CWE-22/CWE-434 | `src/invoice-uploads/invoice-uploads.service.ts`**
- **Vector:** `const [bucket, ...rest] = dto.storagePath.split('/')` aceptaba cualquier bucket, permitiendo a un ADMIN/FACTURADOR leer objetos de otros buckets del proyecto (p. ej. `document-attachments`, privado) vía `downloadAsBuffer`.
- **PoC (pre-fix):** `POST /api/invoice-uploads` con `storagePath: "document-attachments/x.pdf"` → descarga objeto del bucket de adjuntos.
- **Fix:** exigir `bucket === 'invoice-pdfs'` y rechazar `..` en el objectPath.
- **Tests:** `src/invoice-uploads/invoice-uploads.service.spec.ts` (3 tests: bucket distinto, traversal, path válido).
- **Commit:** pendiente en la entrega.

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

## Notas de operación
- Se crearon 5 `public_inquiries` de prueba (`t@t.co`) durante el chequeo de rate limit contra producción. **Limpiar en la DB antes de producción** (o descartar).
- Lint no es gate (deuda pre-existente ~742 errores); no se expandió.

## Comandos usados
- Instalación skills: `npx skills add usestrix/strix -y --global --agent '*'` (9 skills) y `npx skills add affaan-m/ecc -y --global --agent '*'` (ECC completo, instalado en `~\.agents\skills\`).
- Tests: `npx jest` (96/96), build: `npm run build`.