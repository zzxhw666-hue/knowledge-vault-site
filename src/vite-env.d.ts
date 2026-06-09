/// <reference types="vite/client" />

interface KnowledgeVaultConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

interface Window {
  KNOWLEDGE_VAULT_CONFIG?: KnowledgeVaultConfig;
}
