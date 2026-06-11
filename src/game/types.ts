/**
 * 全局类型定义模块。
 *
 * 定义了「情报暗战」策略推演模式的所有核心数据结构，
 * 包括玩家、地图节点、游戏状态、事件系统和操作指令。
 *
 * 注意：角色竞技场模式的类型定义在 arena.ts 中，
 * 仅 PresencePlayer 被两个模式共用。
 */

// =============================================================================
// 基础标识类型
// =============================================================================

/** 玩家唯一标识符（UUID 或 Client ID） */
export type PlayerId = string;

/**
 * 地图上所有据点的 ID 枚举。
 * 布局为 3×3 网格：四个外围据点 + 四个中继站 + 中央核心。
 */
export type NodeId =
  | "outer-northwest"   // 西北外围
  | "outer-northeast"   // 东北外围
  | "outer-southwest"   // 西南外围
  | "outer-southeast"   // 东南外围
  | "relay-north"       // 北部中继
  | "relay-east"        // 东部中继
  | "relay-south"       // 南部中继
  | "relay-west"        // 西部中继
  | "core";             // 中央核心

/** 据点类型：决定据点在地图上的重要性和位置 */
export type NodeKind = "outer" | "relay" | "core";

/**
 * 据点奖励特性。
 * - income:  增加情报点产出速率
 * - attack:  提高核心进攻权重
 * - defense: 巩固核心防守权重
 * - scan:    抵消通信中断事件影响
 * - disrupt: 提高非核心节点争夺权重
 * - vault:   结算时获得额外据点分
 */
export type NodeBonus = "income" | "attack" | "defense" | "scan" | "disrupt" | "vault";

/** 游戏阶段：大厅等待 → 对局进行中 → 结算完成 */
export type GamePhase = "lobby" | "running" | "finished";

/**
 * 随机事件类型。
 * 对局中周期性触发，持续约 22 秒后消退。
 */
export type EventType =
  | "blackout"         // 通信中断 — 隐藏其他玩家的投入细节
  | "double_supply"    // 双倍补给 — 全局情报点产出翻倍
  | "core_exposed"     // 核心暴露 — 提前解除核心加密
  | "decoy_intel"      // 假情报   — 削弱指定据点的投入权重
  | "node_lock"        // 节点封锁 — 暂停指定据点接收新投入
  | "resource_storm";  // 资源风暴 — 全员立即获得额外情报点

// =============================================================================
// 实体接口
// =============================================================================

/** 玩家完整状态（对局中） */
export interface Player {
  id: PlayerId;
  /** 显示名称 */
  name: string;
  /** 玩家颜色（十六进制色值） */
  color: string;
  /** 行动代号 */
  codename: string;
  /** 加入时刻（Unix 毫秒时间戳） */
  joinedAt: number;
  /** 当前可用情报点，用于投入据点 */
  resources: number;
  /** 累计控制核心的毫秒数 */
  coreHoldMs: number;
  /** 是否在线（Presence 同步追踪） */
  online: boolean;
}

/**
 * 地图据点。
 * 玩家通过投入情报点争夺据点控制权，不同据点提供不同奖励。
 */
export interface MapNode {
  id: NodeId;
  /** 据点全称 */
  label: string;
  /** 据点简称 */
  shortLabel: string;
  /** 据点类型 */
  kind: NodeKind;
  /** 据点提供的奖励类型 */
  bonus: NodeBonus;
  /** 地图 X 坐标（百分比） */
  x: number;
  /** 地图 Y 坐标（百分比） */
  y: number;
  /** 据点基础分数 */
  baseScore: number;
  /** 据点描述文本 */
  description: string;
  /** 各玩家在该据点的投入量 */
  investments: Record<PlayerId, number>;
  /** 当前控制者 ID（null = 无人控制） */
  ownerId: PlayerId | null;
  /** 上一次控制者 ID（用于防守加权计算） */
  previousOwnerId: PlayerId | null;
}

/** 当前生效的事件 */
export interface ActiveEvent {
  /** 事件唯一标识符 */
  id: string;
  /** 事件类型 */
  type: EventType;
  /** 事件标题（中文） */
  title: string;
  /** 事件描述（中文） */
  description: string;
  /** 事件开始时刻（Unix 毫秒） */
  startedAt: number;
  /** 事件结束时刻（Unix 毫秒） */
  endsAt: number;
  /** 事件影响的据点 ID（可选，用于 node_lock / decoy_intel） */
  targetNodeId?: NodeId;
}

/** 事件日志条目（展示给玩家） */
export interface EventLogEntry {
  /** 日志唯一标识符 */
  id: string;
  /** 发生时刻 */
  time: number;
  /** 日志标题 */
  title: string;
  /** 日志正文 */
  body: string;
}

/** 游戏完整状态 */
export interface GameState {
  /** 房间码（4 位字母数字） */
  roomCode: string;
  /** 当前游戏阶段 */
  phase: GamePhase;
  /** 房主 ID */
  hostId: PlayerId | null;
  /** 所有玩家（以 ID 为键） */
  players: Record<PlayerId, Player>;
  /** 玩家加入顺序列表 */
  playerOrder: PlayerId[];
  /** 所有据点 */
  nodes: Record<NodeId, MapNode>;
  /** 当前活跃事件（null = 无事件） */
  activeEvent: ActiveEvent | null;
  /** 事件日志（最新在前） */
  eventLog: EventLogEntry[];
  /** 对局开始时刻（null = 未开始） */
  startedAt: number | null;
  /** 上一次 tick 执行时刻 */
  lastTickAt: number | null;
  /** 上一次事件触发时刻 */
  lastEventAt: number | null;
  /** 核心解锁时刻（游戏开始 + CORE_LOCK_MS） */
  coreUnlockedAt: number | null;
  /** 事件计数器（用于种子随机选择） */
  eventCounter: number;
  /** 快照版本号（每次状态变更递增，用于同步冲突检测） */
  snapshotVersion: number;
  /** 随机种子 */
  seed: string;
  /** 胜者 ID（null = 未决出） */
  winnerId: PlayerId | null;
  /** 结束原因文本 */
  finishReason: string | null;
}

/**
 * Presence 玩家（轻量级在线状态）。
 * 由 Supabase Presence 通道维护，不含对局数据如资源和占领计时。
 */
export interface PresencePlayer {
  id: PlayerId;
  name: string;
  color: string;
  codename: string;
  joinedAt: number;
}

/**
 * 投入意图。
 * 玩家选择一个据点和情报点数量，由 Host 验证并执行。
 */
export interface InvestIntent {
  playerId: PlayerId;
  nodeId: NodeId;
  amount: number;
  /** 意图唯一标识（防止重复处理） */
  intentId: string;
  /** 发送时刻 */
  sentAt: number;
}

/**
 * 游戏操作指令（Action）。
 * 所有状态变更都通过 Action 驱动，由 gameReducer 统一处理。
 */
export type GameAction =
  | { type: "syncPlayers"; players: PresencePlayer[]; hostId: PlayerId | null; now: number }
  | { type: "startGame"; now: number }
  | { type: "invest"; intent: InvestIntent; now: number }
  | { type: "tick"; now: number }
  | { type: "resetToLobby"; now: number };

/** 胜者得分摘要 */
export interface WinnerSummary {
  playerId: PlayerId;
  score: number;
}
