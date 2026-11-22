import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export type Config = {
  shop: { id: string; name: string };
  mode: 'demo' | 'supabase';
  ai: 'demo' | 'openai' | 'ollama';
  auth: { url: string; anonKey: string } | null;
};
let auth: SupabaseClient | null = null;
export function authClient(config: Config) {
  if (!auth && config.auth) auth = createClient(config.auth.url, config.auth.anonKey);
  return auth;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = auth ? (await auth.auth.getSession()).data.session : null;
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível conectar ao servidor.');
  return data;
}
