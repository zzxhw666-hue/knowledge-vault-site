/**
 * 「角色竞技场」实时对战模式 — 实时房间 Hook。
 *
 * 职责：
 * 1. 管理 Supabase Realtime Channel 的生命周期
 * 2. Presence 同步：追踪房间内所有在线玩家
 * 3. Broadcast 通信：收发 ArenaSignal（agent、shot、damage、elimination 等）
 * 4. 维护远程 agent 状态（remoteAgents），响应 damage/elimination 信号
 *
 * 与 useRealtimeRoom 的区别：
 * - 竞技场没有 Host 权威架构，每个客户端独立模拟自己的物理
 * - 信号是点对点的：agent 状态、弹丸、伤害、击杀都直接广播
 * - 接收方根据信号类型增量更新远程 agent 状态
 * - 通过 onSignal 回调将所有信号转发给 App.tsx 处理本地逻辑
 *
 * 降级模式：
 * - 当 Supabase 配置缺失时，仅维护本地玩家的在线状态
 * - 所有游戏逻辑在 App.tsx 中本地运行
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ArenaAgent, ArenaSignal } from "../game/arena";
import type { PresencePlayer } from "../game/types";
import { createRealtimeClient } from "../lib/supabase";

/** 连接状态 */
type ConnectionStatus = "connecting" | "connected" | "missing-config" | "error";

/** Broadcast 消息包装 */
interface BroadcastPayload {
  payload: ArenaSignal;
}

/** Presence 元数据 */
interface PresenceMeta {
  player?: PresencePlayer;
}

/** Hook 参数 */
interface UseArenaRoomArgs {
  roomCode: string;
  localPlayer: PresencePlayer;
  /** 信号回调：所有非 agent 更新的信号会转发给调用方 */
  onSignal: (signal: ArenaSignal) => void;
}

/**
 * 竞技场实时房间 Hook。
 *
 * @returns 连接状态、玩家列表、远程 agent 状态、信号发送方法
 */
export function useArenaRoom({ roomCode, localPlayer, onSignal }: UseArenaRoomArgs) {
  // --- 状态 ---
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [presencePlayers, setPresencePlayers] = useState<PresencePlayer[]>([localPlayer]);
  /** 远程 agent 状态（以 ID 为键），排除本地玩家 */
  const [remoteAgents, setRemoteAgents] = useState<Record<string, ArenaAgent>>({});

  // --- Ref ---
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onSignalRef = useRef(onSignal);

  // 保持回调 Ref 最新
  useEffect(() => {
    onSignalRef.current = onSignal;
  }, [onSignal]);

  /**
   * 从 Channel Presence 中读取在线玩家列表。
   * 若列表为空，保留 localPlayer 确保本地显示始终可用。
   */
  const readPresence = useCallback((channel: RealtimeChannel) => {
    const presence = channel.presenceState<PresenceMeta>();
    const players = Object.values(presence)
      .flat()
      .map((meta) => meta.player)
      .filter((player): player is PresencePlayer => Boolean(player?.id))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));

    setPresencePlayers(players.length ? players : [localPlayer]);
  }, [localPlayer]);

  // --- Channel 生命周期 ---

  /**
   * 当 roomCode 或 localPlayer 变化时重建 Channel。
   * 监听 Presence 事件和 arena Broadcast 事件。
   */
  useEffect(() => {
    setConnectionStatus("connecting");
    setErrorMessage("");
    setPresencePlayers([localPlayer]);
    setRemoteAgents({});

    const client = createRealtimeClient();
    // 无配置 → 降级本地模式
    if (!client) {
      setConnectionStatus("missing-config");
      return;
    }

    const channel = client.channel(`arena:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence: { key: localPlayer.id },
      },
    });
    channelRef.current = channel;

    channel
      // Presence 事件
      .on("presence", { event: "sync" }, () => readPresence(channel))
      .on("presence", { event: "join" }, () => readPresence(channel))
      .on("presence", { event: "leave" }, () => readPresence(channel))
      // Arena 信号处理
      .on("broadcast", { event: "arena" }, (message: BroadcastPayload) => {
        const signal = message.payload;

        // Agent 状态更新 → 排除自己（自己的状态由本地循环控制）
        if (signal.type === "agent") {
          if (signal.agent.id !== localPlayer.id) {
            setRemoteAgents((agents) => ({
              ...agents,
              [signal.agent.id]: signal.agent,
            }));
          }
          return;
        }

        // 伤害信号 → 为非本地目标扣血
        if (signal.type === "damage" && signal.targetId !== localPlayer.id) {
          setRemoteAgents((agents) => patchAgent(agents, signal.targetId, (agent) => ({
            ...agent,
            hp: Math.max(0, agent.hp - signal.damage),
            action: "hit",
            updatedAt: signal.time,
          })));
        }

        // 击杀信号 → 更新击杀者和被击杀者状态
        if (signal.type === "elimination") {
          setRemoteAgents((agents) => {
            let next = agents;
            // 被击杀者（非本地）
            if (signal.targetId !== localPlayer.id) {
              next = patchAgent(next, signal.targetId, (agent) => ({
                ...agent,
                hp: 0,
                deaths: agent.deaths + 1,
                action: "down",
                updatedAt: signal.time,
              }));
            }
            // 击杀者（非本地）
            if (signal.killerId !== localPlayer.id) {
              next = patchAgent(next, signal.killerId, (agent) => ({
                ...agent,
                kills: agent.kills + 1,
                updatedAt: signal.time,
              }));
            }
            return next;
          });
        }

        // 转发所有信号给调用方（App.tsx）
        onSignalRef.current(signal);
      })
      .subscribe(async (status, error) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
          // 注册 Presence 并读取初始玩家列表
          await channel.track({ player: localPlayer });
          readPresence(channel);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionStatus("error");
          setErrorMessage(error?.message ?? "房间连接失败。");
        }
      });

    // Cleanup
    return () => {
      channelRef.current = null;
      void channel.untrack();
      void client.removeChannel(channel);
    };
  }, [localPlayer, readPresence, roomCode]);

  // --- 公开方法 ---

  /**
   * 发送竞技场信号给房间内所有其他玩家。
   */
  const sendSignal = useCallback((signal: ArenaSignal) => {
    void channelRef.current?.send({
      type: "broadcast",
      event: "arena",
      payload: signal,
    });
  }, []);

  /**
   * 增量更新指定的远程 Agent。
   * 若 agent 不存在时忽略更新。
   */
  const patchRemoteAgent = useCallback((agentId: string, updater: (agent: ArenaAgent) => ArenaAgent) => {
    setRemoteAgents((agents) => patchAgent(agents, agentId, updater));
  }, []);

  return {
    connectionStatus,
    errorMessage,
    presencePlayers,
    remoteAgents,
    sendSignal,
    patchRemoteAgent,
  };
}

/**
 * 安全地更新 Record 中的指定 agent。
 * 若 agentId 在 Record 中不存在，返回原对象不变。
 */
function patchAgent(
  agents: Record<string, ArenaAgent>,
  agentId: string,
  updater: (agent: ArenaAgent) => ArenaAgent
): Record<string, ArenaAgent> {
  const agent = agents[agentId];
  if (!agent) return agents;
  return {
    ...agents,
    [agentId]: updater(agent),
  };
}
