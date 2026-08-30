# copi-factus-back

Backend API del sistema de gestión y facturación **Copigrafica Sierra**.

> El contexto general (arquitectura, seguridad, despliegue, roadmap) está en el
> **README raíz** del monorepo (`../README.md`).

## Stack

- NestJS 11, Prisma 7
- PostgreSQL (Supabase)
- JWT (+ bcrypt para contraseñas de usuario)

## Requisitos

- Node.js 20+
- PostgreSQL (local o Supabase)

## Inicio rápido

```bash
cp .env.example .env
# Configurar DATABASE_URL, JWT_SECRET y demás variables en .env
npm install
npx prisma generate
npm run db:migrate    # solo si la DB está gestionada por Prisma Migrate
npm run db:seed       # crea usuarios demo con hash bcrypt
npm run start:dev
```

API disponible en `http://localhost:3001/api`

## Variables de entorno

Copia `.env.example` a `.env` y configura:

| Variable | Descripción | Nota |
|----------|-------------|------|
| `DATABASE_URL` | Conexión PostgreSQL (pooler) | usar `sslmode=no-verify` con Supabase |
| `DIRECT_URL` | Conexión directa (scripts) | |
| `SUPABASE_URL` | URL del proyecto Supabase | |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (solo backend) | 🔒 secret |
| `SUPABASE_SECRET_KEY` | Clave de secret | 🔒 secret |
| `JWT_SECRET` | Secreto JWT | **obligatorio, fuerte ≥16 chars**; el app falla si es débil |
| `JWT_EXPIRES_IN` | Expiración del token | por defecto `8h` |
| `CORS_ORIGIN` | Orígenes permitidos (frontend) | |
| `FRONTEND_URL` | URL pública del frontend (correos) | |
| `DEV_PASSWORD` | Contraseña usada para crear/backfill hashes | ¡cámbiala! |

> **Nunca** subas el archivo `.env` a git. Usa `.env.example` como plantilla.

## Autenticación

- **Login**: `POST /api/auth/login` valida con **bcrypt** contra `profiles.password_hash`.
- **JWT**: firmado con `JWT_SECRET`; si no está configurado o es débil, el app **no arranca** (fail-fast).
- **Roles**: `ADMIN`, `FACTURADOR`, `CONSULTA` (guard `RolesGuard` + `JwtAuthGuard`).

⚠️ Los perfiles existentes creados antes de esta versión tienen `password_hash = null`
y deben recibir un hash: `npm run db:seed` o `npm run backfill:password-hashes`.

### Backfill de hashes de contraseña (útil para producción)

```bash
npm run backfill:password-hashes
# usa process.env.DEV_PASSWORD para hashear la contraseña de TODOS los perfiles sin hash.
```

Scripts: `scripts/backfill-password-hashes.ts`, `scripts/list-profiles.ts`.

## Fallback a memoria (solo dev)

Los servicios usan `useInMemoryFallback()` (`src/common/utils/fallback.util.ts`):
- En `NODE_ENV=production` el fallback está **desactivado** y los errores de DB se propagan.
- En dev se puede habilitar con `ALLOW_IN_MEMORY_FALLBACK=true` (por defecto activo en dev).

## Despliegue (Render)

- Archivo `render.yaml` (Blueprint Web Service).
- Build: `npm ci && npx prisma generate && npm run build`
- Start: `npm run start:prod`
- Variables secretas (`sync: false`) se definen en el panel de Render.
- Detalle completo: ver **README raíz** del monorepo.

## Scripts

```bash
npm run start:dev       # Desarrollo
npm run build           # Compilar
npm run start:prod      # Producción (node dist/main)
npm run test            # Tests
npm run lint            # Lint
npm run db:migrate      # Migraciones Prisma
npm run db:seed         # Datos demo (hashea DEV_PASSWORD)
npm run backfill:password-hashes  # Hashea contraseñas de perfiles existentes
```

## Arquitectura

La lógica financiera (totales, saldos, consecutivos, CUFE) se calcula **siempre** en el backend.

## Repo relacionado

- Frontend: [copi-factus-front](https://github.com/asierradev05/copi-factus-front)
