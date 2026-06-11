/**
 * Supabase 客户端工厂模块。
 * 负责从运行时配置中读取连接参数，创建 Supabase Realtime 客户端实例。
 * 若未配置则返回 null，应用将降级为纯本地模式运行。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 获取运行时注入的 Supabase 配置。
 * 配置由 index.html 中的 supabase-config.js 注入到 window 对象上。
 *
 * @returns KnowledgeVaultConfig 配置对象（可能为空对象）
 */
export function getSupabaseConfig() {
  return window.KNOWLEDGE_VAULT_CONFIG ?? {};
}

/**
 * 创建 Supabase Realtime 客户端实例。
 *
 * 特性：
 * - 关闭持久会话和自动刷新令牌（仅需 Realtime 功能，无需 Auth）
 * - 限制广播速率为每秒 30 个事件
 * - 配置缺失时返回 null，调用方需处理降级逻辑
 *
 * @returns SupabaseClient 实例，或 null（配置缺失时）
 */
export function createRealtimeClient(): SupabaseClient | null {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,        // 不持久化会话
      autoRefreshToken: false,      // 不自动刷新令牌
      detectSessionInUrl: false,    // 不从 URL 检测会话
    },
    realtime: {
      params: {
        eventsPerSecond: 30,        // 每秒最多 30 个实时事件
      },
    },
  });
}
