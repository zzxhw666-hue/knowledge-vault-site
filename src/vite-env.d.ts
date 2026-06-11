/// <reference types="vite/client" />

/**
 * 运行时配置注入接口。
 * 通过 index.html 中加载的 supabase-config.js 将后端的 Supabase 连接参数
 * 挂载到 window.KNOWLEDGE_VAULT_CONFIG 上，无需在构建时暴露密钥。
 */
interface KnowledgeVaultConfig {
  /** Supabase 项目 URL */
  supabaseUrl?: string;
  /** Supabase 匿名密钥（Anon Key），用于 Realtime 连接认证 */
  supabaseAnonKey?: string;
}

/**
 * 扩展全局 Window 接口，添加应用运行时配置字段。
 */
interface Window {
  KNOWLEDGE_VAULT_CONFIG?: KnowledgeVaultConfig;
}
