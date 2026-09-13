# Revisión de Seguridad (strix/ecc) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auditar la API NestJS desplegada (`https://copifactushb-back.vercel.app`) y su repo (`D:\copiFactus\backend`) contra OWASP API Top 10, corregir hallazgos con las skills de ECC y dejar la app pasando build + 85/85 tests, sin romper la primera versión funcional ya desplegada.

**Architecture:** Revisión manual (sin Docker/LLM key) guiada por las skills de strix (`api-security-testing`, `web-app-penetration-testing`, `find-security-vulnerabilities-in-code`, `owasp-top-10-testing`) y corrección guiada por skill de ECC. Se combina white-box (código) + black-box básico (curl contra prod). Ningún hallazgo se reporta sin un PoC reproducido.

**Tech Stack:** NestJS 10, Passport/JWT, Prisma/PostgreSQL (Supabase), Supabase Storage (presigned URLs), bcrypt, Helmet, Throttler, class-validator, Factus (API externa DIAN).

**Spec:** `docs/security-audit-2026-09-01.md` (auditoría previa — se complementa, no se repite). Los hallazgos de esa spec se dan como ya verificados (RLS 21/21, guards por controlador, bucket privado, helmet, throttler, bcrypt, sin secretos en repo).

## Global Constraints

- No romper la versión desplegada: toda corrección debe pasar `npm run build` y `npx jest` (85/85) antes de commit.
- No introducir dependencias nuevas sin necesidad.
- No tocar contraseñas ni tokens reales del entorno (leer desde `.env`, nunca hardcodear).
- Lint NO es gate (hay ~742 errores pre-existentes); no expandir esa deuda sin necesidad.
- Texto/errores en español, manteniendo el estilo del código actual.
- No añadir comentarios en el código salvo que un fix lo justifique.
- Commits frecuentes por tarea; push a `main` solo al final (deploy automático).

---

## File Structure

No se crean módulos nuevos. Trabajo sobre archivos existentes (solo los que un hallazgo afecte):

- `src/main.ts` — CORS, helmet, guards/filtros globales, prefix `/api`.
- `src/app.module.ts` — Throttler global (100 req/min), modules.
- `src/auth/*` — login, JWT (estrategia, validez, expiración), bcrypt.
- `src/common/guards/*` + `src/common/decorators/*` — autorización por rol.
- `src/*/*.controller.ts` + `src/*/*.service.ts` — CRUDs y scopes por entidad (21 módulos).
- `src/common/supabase/supabase.service.ts` — presigned upload/download (SSRF / path traversal).
- `src/factus/*` — cliente externo DIAN (SSRF vía `FACTUS_URL`).
- `src/common/email/*` — escape de XSS en plantillas.
- `src/invoices/invoices.service.ts` — `publicUrl` (factura pública).
- `src/public-inquiries/*` — único endpoint POST sin auth (rate-limited).

---

### Task 1: Baseline — build + tests en verde antes de tocar nada

**Files:**
- Read: `package.json`
- Run: `npm run build`, `npx jest`

- [ ] **Step 1: Correr build**
  Run: `cd D:\copiFactus\backend; npm run build`
  Expected: exit 0, compila sin errores de tipos.

- [ ] **Step 2: Correr suite completa**
  Run: `cd D:\copiFactus\backend; npx jest`
  Expected: 85/85 passing.

- [ ] **Step 3: Registrar el punto de partida**
  Run: `git -C D:\copiFactus\backend log --oneline -1`
  Expected: HEAD `064ae18` (último commit estable).

---

### Task 2: Auditar autenticación (JWT + login)

**Files:**
- Read: `src/auth/auth.service.ts`, `src/auth/jwt.strategy.ts`, `src/auth/auth.module.ts`, `src/auth/dto/login.dto.ts`

**Interfaces:**
- Consumes: `LoginDto` (`email`, `password` MinLength 6).
- Produces: lista de hallazgos con `severity`, `file:line`, `poc`, `fix`.

- [ ] **Step 1: Revisar secreto JWT y expiración**
  Verificar en `auth.module.ts` que `JWT_SECRET` se valida con fail-fast (>=16 chars, no `dev-jwt-secret`) y revisar `signAsync` — **no hay `expiresIn` explícito** en `auth.service.ts:50`. Confirmar si `JwtModule.register` define `signOptions: { expiresIn }`.
  Output: anotar ausencia/presencia de expiración de token.

- [ ] **Step 2: Revisar enumeración de usuarios en login**
  Verificar en `auth.service.ts` que mensaje de error es genérico (`Credenciales inválidas.`) tanto para email inexistente como para password incorrecta (ya visto: OK). Revisar `validatePassword` con hash null.
  Output: OK o hallazgo.

- [ ] **Step 3: Revisar timing attack en bcrypt.compare**
  Verificar que el flujo no filtra por mensaje/detalle si email no existe (OK). Anotar que bcrypt.compare solo se llama cuando hay hash (protección estándar).
  Output: OK o nota.

- [ ] **Step 4: Verificar expiración real**
  Buscar `expiresIn` en todo `src/auth` e `invoices`/`quotes` (si existe token de `reset`/`share`). Listar cualquier `signAsync`/`sign(` sin `expiresIn`.
  Output: lista de tokens sin expiración.

- [ ] **Step 5: Commit de hallazgos (documentar, no código)**
  Anotar en `docs/superpowers/plans/2026-09-12-strix-security-review.md` **Results** al final (ver Task 9) o en el reporte de hallazgos. Sin cambio de código: committear el plan actualizado si hubo notas.

---

### Task 3: Auditar control de acceso y topología de roles

**Files:**
- Read: `src/common/guards/roles.guard.ts`, `src/common/decorators/roles.decorator.ts`, `src/common/guards/jwt-auth.guard.ts`
- Grep: `@Roles(` en `src` (inventario por módulo)

**Interfaces:**
- Consumes: `UserRole` enum de Prisma; `AuthUser` (`id`, `email`, `role`, `fullName`).
- Produces: matriz `rol -> endpoints permitidos`, lista de endpoints que usan solo `CONSULTA` pero exponen datos sensibles.

- [ ] **Step 1: Mapear por qué cada módulo usa `CONSULTA`**
  Verificar los módulos que dejan `CONSULTA` ver listados/PDF/dian-xml (invoices 83/98, dian-pdf) — ¿es correcto por negocio?
  Output: matriz.

- [ ] **Step 2: Buscar endpoints sin `@UseGuards` o sin `@Roles`**
  Grep por controllers sin `@UseGuards(JwtAuthGuard, RolesGuard)` a nivel de clase y sin `@Roles` por handler. Confirmar que solo `POST /auth/login` y `POST /public-inquiries` son públicos de forma intencional.
  Output: lista de endpoints protegidos vs públicos esperados.

- [ ] **Step 3: Verificar que el rol viene del JWT y se revalida contra DB**
  En `jwt.strategy.ts` `validate()` llama a `authService.validateUser` (DB) — verificar que un usuario desactivado pierde acceso. Confirmar `toAuthUser` no incluye datos extra.
  Output: OK o hallazgo.

- [ ] **Step 4: Commit**
  Sin código: actualizar el plan si se anotó algo. Si se encontró un endpoint sin proteger, crear tarea de fix (mover a Task 7).

---

### Task 4: Auditar IDOR / scopes por entidad (BOLA/Owasp API1-API3)

**Files:**
- Read: `src/invoices/invoices.service.ts` (métodos `findAll`, `findOne`, `getPdf`, `getDianXml`, `getDianPdf`, `cancel`, `emit`, `notes`), `src/customers/customers.service.ts`, `src/quotes/quotes.service.ts`, `src/services/services.service.ts`, `src/received-documents/*`, `src/delivery-orders/*`, `src/purchase-orders/*`, `src/recurring-services/*`
- Grep: `findUnique({ where: { id }}`, `findFirst`, `update({ where: { id }}`, `delete({ where: { id }}`

**Interfaces:**
- Consumes: `@Param('id')` / `@CurrentUser() user`.
- Produces: lista de `id` que se resuelven sin filtrar por algo del usuario/tanque; PoC cross-tenant si aplica (la app es single-tenant por ahora — anotar si el modelo no tiene multi-tenancy).

- [ ] **Step 1: Confirmar modelo de tenancy**
  Revisar el schema Prisma (`prisma/schema.prisma`): ¿hay columna tipo `companyId`/`tenantId`? Si la app es single-tenant, documentar que el IDOR cross-tenant NO aplica y la frontera es rol-vs-rol.
  Output: veredicto de tenancy.

- [ ] **Step 2: Revisar resolución de entidades por id**
  Leer los `findOne`/`getPdf`/`getDianXml` de invoices, quotes, services, customers, etc. Verificar que el id se pasa a Prisma directo y que el guard protege la ruta. Buscar endpoints que acepten `any` id sin validar formato UUID (Prisma lanza 500?).
  Output: por cada endpoint, confirmación de protección por guard; anotar errores de validación de id no-UUID.

- [ ] **Step 3: Probar id inválido contra API desplegada (black-box)**
  Run (un ejemplo, docs en Task 8):
  ```
  curl -s -o NUL -w "%{http_code}" https://copifactushb-back.vercel.app/api/invoices/not-a-uuid
  curl -s -o NUL -w "%{http_code}" https://copifactushb-back.vercel.app/api/invoices/00000000-0000-0000-0000-000000000000
  ```
  Expected: 401 (sin token). Con token malo: 401. Sin `Authorization`: 401.
  Output: códigos capturados.

- [ ] **Step 4: Commit**
  Anotar hallazgos en el reporte (Task 9). Si se encuentra 500 en lugar de 400 para id no-UUID, llevarlo a Task 7 (fix que devuelve 400/404).

---

### Task 5: Auditar SSRF, path traversal y presigned uploads

**Files:**
- Read: `src/common/supabase/supabase.service.ts`, `src/document-attachments/document-attachments.service.ts` (presignUpload), `src/invoice-uploads/*`, `src/factus/factus-auth.service.ts` (`FACTUS_URL`), `src/factus/factus-adapter.service.ts`
- Grep: `presignUploadUrl|createSignedUploadUrl|createSignedUrl|downloadAsBuffer|fetch\(`

**Interfaces:**
- Consumes: `storagePath`/`fileName` del cliente; `FACTUS_URL` de env.
- Produces: lista de rutas construidas con input de usuario y veredicto sanitización.

- [ ] **Step 1: Revisar construcción de `path` en presign**
  En `document-attachments.service.ts:50`: `attachments/${entityType}/${entityId}/${Date.now()}-${fileName}`. Verificar si `fileName`/`entityType`/`entityId` se sanitizan (la auditoría previa menciona sanitización con `/[^\w.\-() ]/g -> _` en invoice-uploads). Verificar si `entityType` (enum validated) y `entityId` pueden incluir `/` (path traversal → subir fuera del bucket).
  Output: hallazgo si `entityId`/`fileName` permiten `/` o `..`.

- [ ] **Step 2: Revisar invoice-uploads presign**
  Leer `src/invoice-uploads/invoice-uploads.service.ts` y su DTO de presign. Confirmar sanitización idéntica o documentar diferencia.
  Output: OK o hallazgo.

- [ ] **Step 3: Revisar uso de `FACTUS_URL` (SSRF)**
  En `factus-auth.service.ts:68`, fetch a `FACTUS_URL` de env (no de input de usuario) — verificar que ningún endpoint permita al cliente elegir la URL de Factus. Confirmar que el adapter no acepta URL del body.
  Output: OK o hallazgo.

- [ ] **Step 4: Revisar descargas (`getFile`)**
  `document-attachments.controller.ts:31` `GET :id/file` devuelve signed URL — verificar que el id es UUID y se resuelve vía `findOne` (rouca {404}).
  Output: OK o hallazgo.

- [ ] **Step 5: Fix si hay hallazgo, o commit de OK**
  Si hay path traversal: validar con `class-validator` (`IsUUID` para entityId, sanitizar fileName) y añadir test que lo demuestre. Ver "Task 7" para formato; correr build + jest.
  Commit: `fix(security): sanitizar ruta de storage en presign de adjuntos`.

---

### Task 6: Auditar inyección, mass assignment y XSS en plantillas

**Files:**
- Read: `src/common/email/branded-email.template.ts` (escapeHtml), `src/common/email/branded-email.template.spec.ts` (tests de escape), `src/invoice-uploads/invoice-uploads.service.ts` (subida de archivos), `src/audit/audit.service.ts` (qué se loguea)
- Grep: `raw|newValue|JSON.stringify|prisma.` con `$queryRaw|$executeRaw`

**Interfaces:**
- Consumes: campos del cliente (nombre de cliente, notas, dirección, comentarios).
- Produces: veredicto de uso de Prisma no-raw (SQL injection) y de escape en HTML.

- [ ] **Step 1: Verificar que NO hay raw SQL**
  Grep en `src` por `$queryRaw|$executeRaw|prisma.$executeRawUnsafe`.
  Output: lista vacía = OK.

- [ ] **Step 2: Verificar escape en emails**
  Confirmar en `branded-email.template.ts` que todos los valores interpolados (title, subtitle, rows[].value, total, status, DIAN, cta, footer, logo HREF) pasan por `escapeHtml` (los tests ya lo prueban — line 183 CTA con `<script>`). Listar cualquier interpolarización sin escape.
  Output: OK o hallazgo.

- [ ] **Step 3: Auditar mass assignment en updates**
  Revisar `@ValidationPipe` global (`whitelist: true, forbidNonWhitelisted: true`) — ya cubre. Verificar DTOs de PATCH (customers, services, settings, users) que solo reciben campos `@IsOptional` explícitos (no `any`).
  Output: OK o hallazgo.

- [ ] **Step 4: Verificar audit no loguea secretos**
  Confirmar que `audit.service.ts` loguea `newValue` serializado y que ningún DTO que llega a audit incluye `password`. Usuarios: confirmar que `create` de admin hashea con `hashPassword` antes de persistir.
  Output: OK o hallazgo.

- [ ] **Step 5: Commit**
  Si todo OK, sin commit de código (o commit documental si hubo nota). Si hay hallazgo, crear fix + test en Task 7.

---

### Task 7: Corregir hallazgos (ECC) — plantilla TDD

> Esta tarea se completa UNA vez por cada hallazgo real de Tasks 2-6. Ignorar si no hay hallazgos.

**Files:**
- Modify: el archivo del hallazgo (p. ej. `src/document-attachments/document-attachments.service.ts`)
- Test: `src/<modulo>/<modulo>.spec.ts` (o el spec existente)

**Interfaces:**
- Consumes: hallazgo con severidad, punto exacto y PoC.
- Produces: fix + test verde + build verde.

- [ ] **Step 1: Escribir test que falle**

```typescript
// Ejemplo si el hallazgo es path traversal en presign
it('rechaza fileName con path traversal en presign', async () => {
  await expect(
    service.presignUpload('../../etc/passwd', 'invoice', 'uuid'),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Correr test para verificar que falla**

Run: `npx jest src/document-attachments --testPathPattern=presign -t "path traversal"`
Expected: FAIL (la ruta se construye sin rechazo).

- [ ] **Step 3: Implementar fix mínimo en el service (o DTO)**

```typescript
private sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-() ]/g, '_').slice(0, 255);
}
```

- [ ] **Step 4: Correr test para verificar que pasa**

Run: `npx jest src/document-attachments`
Expected: PASS.

- [ ] **Step 5: Build + suite completa**

Run: `npm run build; npx jest`
Expected: build OK, 85/85 + nuevos tests.

- [ ] **Step 6: Commit**

```bash
git -C D:\copiFactus\backend add -A
git -C D:\copiFactus\backend commit -m "fix(security): <descripción del hallazgo corregido>"
```

---

### Task 8: Smokescreen black-box contra API desplegada

**Files:**
- Run: curl contra `https://copifactushb-back.vercel.app/api`

- [ ] **Step 1: Verificar prefijo y CORS**
  ```
  curl -s -o NUL -w "%{http_code}" https://copifactushb-back.vercel.app/api/auth/login
  curl -s -o NUL -w "%{http_code}" https://copifactushb-back.vercel.app/api/dashboard/kanban
  ```
  Expected: 400 (login sin body) / 401 (sin token). Confirmar que no devuelve HTML de 404 del serverless.

- [ ] **Step 2: Verificar rate limit visible**
  Send 101 requests a un endpoint público (public-inquiries) en <60s y confirmar 429 desde aproximadamente req 101, o confirmar el header `Retry-After`/`X-RateLimit`.

- [ ] **Step 3: Verificar headers de seguridad**
  ```
  curl -sI https://copifactushb-back.vercel.app/api/health  (o login)
  ```
  Expected: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy` de Helmet presentes.

- [ ] **Step 4: Confirmar que se sirve HTTPS y sin server header sensible**
  Confirmar que `Server` no filtra versión de Node/Express. Anotar hallazgo si se expone.

---

### Task 9: Reporte final de hallazgos + cierre

**Files:**
- Create: `docs/security-audit-2026-09-12-strix.md`
- Modify: `docs/superpowers/plans/2026-09-12-strix-security-review.md` (Results)

- [ ] **Step 1: Escribir reporte de hallazgos**
  Tabla con: `#`, `CWE`, `severity`, `endpoint/archivo:línea`, `PoC`, `estado` (corregido/aceptado/NA).

- [ ] **Step 2: Build + tests finales**
  Run: `npm run build; npx jest`
  Expected: build OK, 85/85 (o más si hubo fixes).

- [ ] **Step 3: Commit del reporte**

```bash
git -C D:\copiFactus\backend add -A
git -C D:\copiFactus\backend commit -m "docs(security): reporte de revisión strix/ecc 2026-09-12"
```

- [ ] **Step 4: Push a main y verificar deploy**

```bash
git -C D:\copiFactus\backend push origin main
gh run watch <run-id>
```

Expected: deploy en Vercel en verde.