/**
 * 「情报暗战」策略推演模式 — 实时房间 Hook。
 *
 * 职责：
 * 1. 管理 Supabase Realtime Channel 的生命周期（创建、订阅、清理）
 * 2. Presence 同步：追踪房间内所有在线玩家
 * 3. Broadcast 通信：收发 snapshot / intent / control 消息
 * 4. Host 权威模式：只有房主执行 gameReducer 并广播状态快照
 *
 * 通信架构：
 * - Host 执行所有游戏逻辑（invest、tick、start、reset）
 * - 非 Host 客户端通过 broadcast 提交意图给 Host
 * - Host 广播 snapshot 给所有客户端同步状态
 * - Presence 由 Supabase 自动管理，join/leave 时触发重新计算 hostId
 *
 * 降级模式：
 * - 当 Supabase 配置缺失时（connectionStatus = "missing-config"），
 *   创建本地单机状态，所有操作直接生效无需网络。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createRealtimeClient } from "../lib/supabase";
import { createInitialGameState, gameReducer } from "../game/rules";
import type { GameAction, GameState, InvestIntent, PresencePlayer } from "../game/types";

/** 连接状态枚举 */
type ConnectionStatus = "idle" | "connecting" | "connected" | "missing-config" | "error";

/** Hook 参数 */
interface UseRealtimeRoomArgs {
  roomCode: string;
  localPlayer: PresencePlayer;
}

/** Broadcast 消息包装结构 */
interface BroadcastPayload<T> {
  payload: T;
}

/** 状态快照消息 */
interface SnapshotMessage {
  state: GameState;
}

/** 投入意图消息 */
interface IntentMessage {
  intent: InvestIntent;
}

/** 控制指令消息（开始/重置） */
interface ControlMessage {
  action: "start" | "reset";
  requestedBy: string;
  now: number;
}

/** Presence 元数据（附加玩家信息） */
interface PresenceMeta {
  player?: PresencePlayer;
}

/**
 * 实时房间 Hook。
 *
 * @returns room 对象，包含游戏状态、玩家列表、连接状态和操作方法
 */
export function useRealtimeRoom({ roomCode, localPlayer }: UseRealtimeRoomArgs) {
  // --- 状态 ---
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [gameState, setGameState] = useState<GameState>(() => createInitialGameState(roomCode));
  const [presencePlayers, setPresencePlayers] = useState<PresencePlayer[]>([]);

  // --- Ref（避免闭包陷阱，确保回调中始终访问最新值） ---
  const channelRef = useRef<RealtimeChannel | null>(null);
  const gameStateRef = useRef(gameState);
  const localPlayerRef = useRef(localPlayer);

  // 保持 Ref 与 State 同步
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { localPlayerRef.current = localPlayer; }, [localPlayer]);

  /** 当前客户端是否是房主 */
  const isHost = gameState.hostId === localPlayer.id;

  // --- 通信方法 ---

  /**
   * 广播完整游戏状态快照。
   * 仅在 Host 端调用，将所有客户端同步到最新状态。
   */
  const broadcastSnapshot = useCallback((state: GameState) => {
    void channelRef.current?.send({
      type: "broadcast",
      event: "snapshot",
      payload: { state } satisfies SnapshotMessage,
    });
  }, []);

  /**
   * 以 Host 身份执行一次 Action。
   * 更新本地状态 → 更新 Ref → 广播 snapshot。
   */
  const applyHostAction = useCallback(
    (action: GameAction) => {
      setGameState((previous) => {
        const next = gameReducer(previous, action);
        gameStateRef.current = next;
        broadcastSnapshot(next);
        return next;
      });
    },
    [broadcastSnapshot]
  );

  /**
   * 从 Channel 的 Presence 状态中提取在线玩家列表。
   * 按加入时间排序，hostId 始终为列表第一位玩家。
   */
  const readPresencePlayers = useCallback((channel: RealtimeChannel): PresencePlayer[] => {
    const state = channel.presenceState<PresenceMeta>();
    return Object.values(state)
      .flat()
      .map((meta) => meta.player)
      .filter((player): player is PresencePlayer => Boolean(player?.id))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  }, []);

  /**
   * 处理 Presence 同步事件。
   * 更新在线玩家列表，重新计算 hostId，触发 gameReducer。
   */
  const syncPresence = useCallback(
    (channel: RealtimeChannel) => {
      const players = readPresencePlayers(channel);
      const hostId = players[0]?.id ?? null;
      setPresencePlayers(players);

      setGameState((previous) => {
        const next = gameReducer(previous, {
          type: "syncPlayers",
          players,
          hostId,
          now: Date.now(),
        });
        gameStateRef.current = next;
        // 若本地玩家成为 Host，立即广播新的状态
        if (hostId === localPlayerRef.current.id) {
          broadcastSnapshot(next);
        }
        return next;
      });
    },
    [broadcastSnapshot, readPresencePlayers]
  );

  // --- Channel 生命周期 ---

  /**
   * 当 roomCode 或 localPlayer 变化时，重新创建 Realtime Channel。
   * 设置 Presence / Broadcast 事件监听器，在 cleanup 时移除 Channel。
   */
  useEffect(() => {
    // 重置状态
    setGameState(createInitialGameState(roomCode));
    setPresencePlayers([]);
    setErrorMessage("");

    const client = createRealtimeClient();
    // 无 Supabase 配置 → 降级为本地模式
    if (!client) {
      const fallbackState = gameReducer(createInitialGameState(roomCode), {
        type: "syncPlayers",
        players: [localPlayer],
        hostId: localPlayer.id,
        now: Date.now(),
      });
      setGameState(fallbackState);
      setPresencePlayers([localPlayer]);
      setConnectionStatus("missing-config");
      return;
    }

    setConnectionStatus("connecting");
    const channel = client.channel(`game:${roomCode}`, {
      config: {
        broadcast: { self: false },          // 不接收自己发送的 Broadcast
        presence: { key: localPlayer.id },    // Presence 以玩家 ID 为唯一键
      },
    });
    channelRef.current = channel;

    channel
      // Presence 事件 → 同步玩家列表
      .on("presence", { event: "sync" }, () => syncPresence(channel))
      .on("presence", { event: "join" }, () => syncPresence(channel))
      .on("presence", { event: "leave" }, () => syncPresence(channel))
      // Intent 广播 → 仅 Host 处理
      .on("broadcast", { event: "intent" }, (message: BroadcastPayload<IntentMessage>) => {
        if (gameStateRef.current.hostId !== localPlayerRef.current.id) return;
        applyHostAction({ type: "invest", intent: message.payload.intent, now: Date.now() });
      })
      // Control 广播 → 仅 Host 处理
      .on("broadcast", { event: "control" }, (message: BroadcastPayload<ControlMessage>) => {
        if (gameStateRef.current.hostId !== localPlayerRef.current.id) return;
        if (message.payload.action === "start") {
          applyHostAction({ type: "startGame", now: message.payload.now });
        }
        if (message.payload.action === "reset") {
          applyHostAction({ type: "resetToLobby", now: message.payload.now });
        }
      })
      // Snapshot 广播 → 所有客户端接收（含版本冲突检测）
      .on("broadcast", { event: "snapshot" }, (message: BroadcastPayload<SnapshotMessage>) => {
        setGameState((previous) => {
          const incoming = message.payload.state;
          // 版本检测：只接受更新的或 Host 变更后的快照
          if (!shouldAcceptSnapshot(previous, incoming)) return previous;
          gameStateRef.current = incoming;
          return incoming;
        });
      })
      .subscribe(async (status, error) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
          // 订阅成功后注册 Presence 并同步
          await channel.track({ player: localPlayerRef.current });
          syncPresence(channel);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionStatus("error");
          setErrorMessage(error?.message ?? "房间连接失败。");
        }
      });

    // Cleanup：移除 Channel 时自动 untrack + 清理
    return () => {
      channelRef.current = null;
      void channel.untrack();
      void client.removeChannel(channel);
    };
  }, [applyHostAction, localPlayer, roomCode, syncPresence]);

  // --- Tick 定时器 ---

  /**
   * Host 端的每秒 tick 定时器。
   * 仅在 running 阶段且当前客户端为 Host 时激活。
   */
  useEffect(() => {
    if (!isHost || gameState.phase !== "running") return;
    const timer = window.setInterval(() => {
      applyHostAction({ type: "tick", now: Date.now() });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [applyHostAction, gameState.phase, isHost]);

  // --- 公开操作方法 ---

  /**
   * 发送投入指令。
   * Host / 降级模式直接执行；非 Host 广播 intent 给 Host。
   */
  const sendInvest = useCallback(
    (intent: InvestIntent) => {
      if (gameStateRef.current.hostId === localPlayerRef.current.id || connectionStatus === "missing-config") {
        applyHostAction({ type: "invest", intent, now: Date.now() });
        return;
      }
      void channelRef.current?.send({
        type: "broadcast",
        event: "intent",
        payload: { intent } satisfies IntentMessage,
      });
    },
    [applyHostAction, connectionStatus]
  );

  /**
   * 请求开始对局。
   * Host / 降级模式直接执行；非 Host 广播 control 给 Host。
   */
  const requestStart = useCallback(() => {
    const payload = {
      action: "start",
      requestedBy: localPlayerRef.current.id,
      now: Date.now(),
    } satisfies ControlMessage;

    if (gameStateRef.current.hostId === localPlayerRef.current.id || connectionStatus === "missing-config") {
      applyHostAction({ type: "startGame", now: payload.now });
      return;
    }

    void channelRef.current?.send({ type: "broadcast", event: "control", payload });
  }, [applyHostAction, connectionStatus]);

  /**
   * 请求重置回大厅。
   * Host / 降级模式直接执行；非 Host 广播 control 给 Host。
   */
  const requestReset = useCallback(() => {
    const payload = {
      action: "reset",
      requestedBy: localPlayerRef.current.id,
      now: Date.now(),
    } satisfies ControlMessage;

    if (gameStateRef.current.hostId === localPlayerRef.current.id || connectionStatus === "missing-config") {
      applyHostAction({ type: "resetToLobby", now: payload.now });
      return;
    }

    void channelRef.current?.send({ type: "broadcast", event: "control", payload });
  }, [applyHostAction, connectionStatus]);

  // 汇总返回值（useMemo 避免不必要的重渲染）
  const room = useMemo(
    () => ({
      gameState,
      presencePlayers,
      connectionStatus,
      errorMessage,
      isHost,
      sendInvest,
      requestStart,
      requestReset,
    }),
    [connectionStatus, errorMessage, gameState, isHost, presencePlayers, requestReset, requestStart, sendInvest]
  );

  return room;
}

// =============================================================================
// 内部工具
// =============================================================================

/**
 * 判断是否接受来自 Host 的 Snapshot。
 *
 * 接受条件（满足任一）：
 * 1. 房间码不同 → 拒绝（属于其他房间）
 * 2. 快照版本严格更高 → 接受
 * 3. Host 发生了变化（说明新 Host 接管）且 tick 不落后 → 接受
 */
function shouldAcceptSnapshot(previous: GameState, incoming: GameState): boolean {
  if (previous.roomCode !== incoming.roomCode) return false;
  if (incoming.snapshotVersion > previous.snapshotVersion) return true;
  const incomingTick = incoming.lastTickAt ?? 0;
  const previousTick = previous.lastTickAt ?? 0;
  // Host 切换时，即使版本号相同，只要 tick 不倒退也接受
  return incoming.hostId !== previous.hostId && incomingTick >= previousTick;
}
