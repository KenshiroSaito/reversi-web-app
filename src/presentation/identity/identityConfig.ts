export interface IdentityConfig {
  ipHashSecret: string;
  onVercel: boolean;
}

const MIN_SECRET_LENGTH_ON_VERCEL = 32;

/** Read on first guest creation, so a missing secret fails that request only. */
export function loadIdentityConfig(env: NodeJS.ProcessEnv): IdentityConfig {
  const secret = env.IP_HASH_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable IP_HASH_SECRET");
  }
  const onVercel = Boolean(env.VERCEL);
  if (onVercel && secret.length < MIN_SECRET_LENGTH_ON_VERCEL) {
    throw new Error(`IP_HASH_SECRET must be at least ${MIN_SECRET_LENGTH_ON_VERCEL} characters on Vercel`);
  }
  return { ipHashSecret: secret, onVercel };
}
