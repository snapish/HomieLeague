# API Quick Start (Postgres)

This API uses plain Postgres with lightweight SQL migrations so you can learn the database directly.

## 1. Install and run PostgreSQL

On Windows with winget:

```bash
winget install --id PostgreSQL.PostgreSQL.17 -e --source winget --accept-source-agreements --accept-package-agreements
```

## 2. Configure environment

Copy `.env.example` to `.env` in this folder and adjust credentials if needed.
The API auto-loads `apps/api/.env` for both runtime and migrations.

Variables:

- `DATABASE_URL`
- `DATABASE_SSL`
- `WEB_ORIGIN`
- `SESSION_LIFETIME_HOURS`
- `PORT`

## 3. Create database (one-time)

From repository root:

```bash
npm run db:create -w @homieleague/api
```

## 4. Apply migration

From repository root:

```bash
npm run db:migrate -w @homieleague/api
```

This runs SQL in `apps/api/sql/001_auth_init.sql`.

## 5. Run API

```bash
npm run dev:api
```

## Auth endpoints

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me` with `Authorization: Bearer <sessionToken>`
