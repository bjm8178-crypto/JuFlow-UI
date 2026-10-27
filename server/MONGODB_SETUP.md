# JuKi Server - Database Setup Guide

> **⚠️ This document is partially outdated.** Production now uses **PostgreSQL** via `DATABASE_URL`. MongoDB is the legacy database and is being phased out. See the main [server README](./README.md) for current production setup.

## Current Status

- **Production (Render):** PostgreSQL via `DATABASE_URL` environment variable.
- **Local development:** MongoDB is still supported for development via `MONGODB_URI` + `DB_NAME`.
- **Migration tool:** `npm run migrate:mongo-to-pg` migrates data from MongoDB to PostgreSQL.

## Production Setup (PostgreSQL)

The first admin account is created from environment variables:

```env
DATABASE_URL=postgres://user:password@host:5432/juflow
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<a-strong-password>
```

> **There is no seed script or default `admin123` password in production.** Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in your Render environment.

## Local Development (MongoDB)

For local development you can still use MongoDB:

```env
MONGODB_URI=mongodb://localhost:27017
DB_NAME=juflow_dev
NODE_ENV=development
```

## PostgreSQL Files

| File | Purpose |
|---|---|
| `src/db/postgres.js` | PostgreSQL connection pool and query helpers |
| `src/db/schema.sql` | PostgreSQL schema definition |
| `src/db/repositories/` | Data access layer for PostgreSQL |
| `src/db/migrate-mongo-to-pg.js` | One-time migration script from MongoDB → PostgreSQL |

## MongoDB Collections (legacy)

When using MongoDB locally, the database uses these collections:
`roles`, `users`, `auth_sessions`, `riders`, `customers`, `delivery_zones`, `categories`, `products`, `orders`, `deliveries`, `gcash_proofs`, `sales`, `settings`, `media_files`.

## NPM Scripts

```bash
npm run dev               # Start server with auto-reload
npm start                 # Start server (production)
npm run migrate:mongo-to-pg  # Migrate MongoDB data to PostgreSQL
npm test                  # Run tests
```
