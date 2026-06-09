import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabaseConfig() {
  return window.KNOWLEDGE_VAULT_CONFIG ?? {};
}

export function createRealtimeClient(): SupabaseClient | null {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 30,
      },
    },
  });
}
