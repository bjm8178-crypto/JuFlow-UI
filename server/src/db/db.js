import * as postgres from './postgres.js';
import * as mongodb from './mongodb.js';
import dotenv from 'dotenv';

dotenv.config();

export const isPostgres = () => Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URI || process.env.PG_URL);

export async function connect() {
  if (isPostgres()) {
    console.log('📦 Using PostgreSQL database driver');
    return await postgres.connect();
  } else {
    console.log('🍃 Using MongoDB database driver');
    return await mongodb.connect();
  }
}

export function getDb() {
  if (isPostgres()) {
    return postgres.getDb();
  } else {
    return mongodb.getDb();
  }
}

export async function withTransaction(work) {
  if (isPostgres()) {
    return await postgres.withTransaction(work);
  } else {
    return await mongodb.withTransaction(work);
  }
}

export async function readiness() {
  if (isPostgres()) {
    return await postgres.readiness();
  } else {
    return await mongodb.readiness();
  }
}

export async function close() {
  if (isPostgres()) {
    return await postgres.close();
  } else {
    return await mongodb.close();
  }
}

export function toObjectId(id) {
  if (isPostgres()) {
    return postgres.toObjectId(id);
  } else {
    return mongodb.toObjectId(id);
  }
}

export function timestamps() {
  return isPostgres() ? postgres.timestamps() : mongodb.timestamps();
}

export function updateTimestamp() {
  return isPostgres() ? postgres.updateTimestamp() : mongodb.updateTimestamp();
}

export const ObjectId = isPostgres() ? postgres.ObjectId : mongodb.ObjectId;
export { postgres, mongodb };
