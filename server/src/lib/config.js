export function productionConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origins = (env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of origins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS must contain exact origins'); }
    if (url.origin !== origin || url.username || url.password || (production && url.protocol !== 'https:')) {
      throw new Error('CORS_ORIGINS must contain exact HTTPS origins in production');
    }
  }
  const rawProxy = env.TRUST_PROXY ?? '0';
  const trustProxy = /^\d+$/.test(rawProxy) ? Number(rawProxy) : rawProxy.split(',').map(value => value.trim());
  if (typeof trustProxy === 'number' && (!Number.isSafeInteger(trustProxy) || trustProxy > 10)) throw new Error('Invalid TRUST_PROXY');
  if (Array.isArray(trustProxy) && trustProxy.some(value => !value || value === 'true' || value === 'false')) throw new Error('Invalid TRUST_PROXY');
  return { production, origins, trustProxy };
}

export function validateStartup(env = process.env) {
  const config = productionConfig(env);
  if (config.production) {
    const hasPostgres = Boolean(env.DATABASE_URL || env.POSTGRES_URI || env.PG_URL);
    if (!hasPostgres && (!env.MONGODB_URI || !env.DB_NAME)) throw new Error('DATABASE_URL (PostgreSQL) or explicit MONGODB_URI and DB_NAME are required in production');
    if (!config.origins.length) throw new Error('CORS_ORIGINS is required for production cookie writes');
    if (!env.TRUST_PROXY) throw new Error('Explicit verified TRUST_PROXY is required in production');
  }
  return config;
}

export function seedAllowed(env = process.env) {
  return env.NODE_ENV !== 'production' && env.SEED_CONFIRM_DATABASE === env.DB_NAME &&
    /^juflow_(?:dev|test)(?:_[a-z0-9_]+)?$/.test(env.DB_NAME || '');
}
