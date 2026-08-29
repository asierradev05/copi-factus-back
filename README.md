# copi-factus-back

Backend API del sistema de gestión y facturación **Copigrafica Sierra**.

## Stack

- NestJS, Prisma
- PostgreSQL (Supabase)
- JWT / Supabase Auth

## Requisitos

- Node.js 20+
- PostgreSQL (local o Supabase)

## Inicio rápido

```bash
cp .env.example .env
# Configurar DATABASE_URL y demás variables en .env
npm install
npm run db:migrate
npm run db:seed
npm run start:dev
```

API disponible en `http://localhost:3001/api`

## Variables de entorno

Copia `.env.example` a `.env` y configura:

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Conexión PostgreSQL |
| `DIRECT_URL` | Conexión directa (migraciones) |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (solo backend) |
| `JWT_SECRET` | Secreto para tokens JWT |
| `CORS_ORIGIN` | Orígenes permitidos (frontend) |

> **Nunca** subas el archivo `.env` a git. Usa `.env.example` como plantilla.

## Usuarios de desarrollo

| Email | Rol | Contraseña |
|-------|-----|------------|
| admin@copigrafica.dev | ADMIN | Admin123! |
| facturador@copigrafica.dev | FACTURADOR | Admin123! |
| consulta@copigrafica.dev | CONSULTA | Admin123! |

## Scripts

```bash
npm run start:dev    # Desarrollo
npm run build        # Compilar
npm run test         # Tests
npm run db:migrate   # Migraciones Prisma
npm run db:seed      # Datos demo
```

## Arquitectura

La lógica financiera (totales, saldos, consecutivos) se calcula siempre en el backend.

## Repo relacionado

- Frontend: [copi-factus-front](https://github.com/asierradev05/copi-factus-front)
