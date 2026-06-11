/**
 * 「情报暗战」策略推演模式 — 核心规则引擎。
 *
 * 这是一个纯函数式状态机，所有状态变更通过 gameReducer(action) 驱动。
 * 设计原则：
 * - 每个 reducer 返回全新的 GameState（不可变更新）
 * - Host 权威架构：只有房主执行游戏逻辑，其他客户端接收 snapshot 同步
 * - tick 驱动经济系统：每秒触发一次，处理资源产出、事件、控制权、胜负判定
 *
 * 核心机制：
 * 1. 玩家投入情报点争夺据点控制权
 * 2. 控制中继站可获得核心进攻/防守加权
 * 3. 持续控制核心足够时间 = 直接获胜
 * 4. 随机事件周期性改变战场局势
 * 5. 对局时间耗尽按积分结算
 */
import {
  BASE_RESOURCE_PER_SECOND,
  CORE_HOLD_TO_WIN_MS,
  CORE_LOCK_MS,
  EVENT_DURATION_MS,
  EVENT_INTERVAL_MS,
  EVENT_TYPES,
  INITIAL_NODES,
  MATCH_DURATION_MS,
  MAX_PLAYERS,
  MAX_SNAPSHOT_LOG,
  NODE_ORDER,
  STARTING_RESOURCES,
} from "./config";
import type {
  ActiveEvent,
  EventLogEntry,
  EventType,
  GameAction,
  GameState,
  InvestIntent,
  MapNode,
  NodeId,
  Player,
  PlayerId,
  PresencePlayer,
  WinnerSummary,
} from "./types";

// =============================================================================
// 公开 API — 状态初始化与 Reducer
// =============================================================================

/**
 * 创建全新的初始游戏状态。
 * 所有据点为无人控制，无事件，阶段为 lobby。
 *
 * @param roomCode 房间码
 * @param seed     随机种子（默认使用房间码）
 */
export function createInitialGameState(roomCode: string, seed = roomCode): GameState {
  return {
    roomCode,
    phase: "lobby",
    hostId: null,
    players: {},
    playerOrder: [],
    nodes: cloneNodes(),
    activeEvent: null,
    eventLog: [],
    startedAt: null,
    lastTickAt: null,
    lastEventAt: null,
    coreUnlockedAt: null,
    eventCounter: 0,
    snapshotVersion: 0,
    seed,
    winnerId: null,
    finishReason: null,
  };
}

/**
 * 游戏状态主 Reducer。
 * 所有状态变更都经过此函数，每次调用后 snapshotVersion 自动递增。
 *
 * @param state  当前状态
 * @param action 操作指令
 * @returns 新状态
 */
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "syncPlayers":
      return bump(syncPlayers(state, action.players, action.hostId, action.now));
    case "startGame":
      return bump(startGame(state, action.now));
    case "invest":
      return bump(applyInvest(state, action.intent, action.now));
    case "tick":
      return bump(tickGame(state, action.now));
    case "resetToLobby":
      return bump(resetToLobby(state, action.now));
    default:
      return state;
  }
}

// =============================================================================
// Action 处理器
// =============================================================================

/**
 * 处理 Presence 同步。
 * 根据在线玩家列表更新玩家状态：新增在线玩家、标记离线玩家、
 * 更新 hostId（第一位加入者）、维护 playerOrder。
 */
export function syncPlayers(state: GameState, presencePlayers: PresencePlayer[], hostId: PlayerId | null, now: number): GameState {
  // 去重并按加入时间排序，限制最大玩家数
  const uniquePlayers = [...new Map(presencePlayers.map((player) => [player.id, player])).values()]
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
    .slice(0, MAX_PLAYERS);

  const onlineIds = new Set(uniquePlayers.map((player) => player.id));
  const players: Record<PlayerId, Player> = { ...state.players };

  // 新增 / 更新在线玩家
  for (const presencePlayer of uniquePlayers) {
    const previous = players[presencePlayer.id];
    players[presencePlayer.id] = {
      id: presencePlayer.id,
      name: presencePlayer.name,
      color: presencePlayer.color,
      codename: presencePlayer.codename,
      joinedAt: presencePlayer.joinedAt,
      // 若对局已开始，新加入的玩家获得起始资源
      resources: previous?.resources ?? (state.phase === "running" ? STARTING_RESOURCES : 0),
      coreHoldMs: previous?.coreHoldMs ?? 0,
      online: true,
    };
  }

  // 标记不在 Presence 中的玩家为离线
  for (const playerId of Object.keys(players)) {
    players[playerId] = {
      ...players[playerId],
      online: onlineIds.has(playerId),
    };
  }

  return {
    ...state,
    hostId,
    players,
    playerOrder: uniquePlayers.map((player) => player.id),
    lastTickAt: state.lastTickAt ?? now,
  };
}

/**
 * 开始对局。
 * 重置所有据点、清除事件、初始化玩家资源和核心锁定计时器。
 */
export function startGame(state: GameState, now: number): GameState {
  const players: Record<PlayerId, Player> = {};
  const playerOrder = state.playerOrder.filter((playerId) => state.players[playerId]?.online).slice(0, MAX_PLAYERS);

  for (const playerId of playerOrder) {
    const player = state.players[playerId];
    players[playerId] = {
      ...player,
      resources: STARTING_RESOURCES,
      coreHoldMs: 0,
      online: true,
    };
  }

  return {
    ...state,
    phase: "running",
    players,
    playerOrder,
    nodes: cloneNodes(),
    activeEvent: null,
    eventLog: [
      logEntry(now, "行动开始", "外围据点已开放，核心正在加密锁定。"),
      ...state.eventLog,
    ].slice(0, MAX_SNAPSHOT_LOG),
    startedAt: now,
    lastTickAt: now,
    lastEventAt: now,
    // 核心在 CORE_LOCK_MS 毫秒后解锁，届时才可投入
    coreUnlockedAt: now + CORE_LOCK_MS,
    eventCounter: 0,
    winnerId: null,
    finishReason: null,
  };
}

/**
 * 应用投入指令。
 * 验证玩家和据点的有效性，扣除资源，增加投入量，然后重新判定控制权。
 */
export function applyInvest(state: GameState, intent: InvestIntent, now: number): GameState {
  // 仅 running 阶段允许投入
  if (state.phase !== "running") return state;

  const player = state.players[intent.playerId];
  const node = state.nodes[intent.nodeId];
  if (!player || !player.online || !node) return state;

  // 检查据点是否可投入（核心是否已解锁、是否被事件封锁）
  if (!canInvestInNode(state, intent.nodeId, now)) return state;

  // 限制投入量不超过实际持有资源
  const amount = clampInvestment(intent.amount, player.resources);
  if (amount <= 0) return state;

  // 扣除资源
  const players = {
    ...state.players,
    [player.id]: {
      ...player,
      resources: roundResource(player.resources - amount),
    },
  };

  // 增加据点投入量
  const nodes = {
    ...state.nodes,
    [node.id]: {
      ...node,
      investments: {
        ...node.investments,
        [player.id]: roundResource((node.investments[player.id] ?? 0) + amount),
      },
    },
  };

  // 重新判定所有据点的控制权
  return resolveNodeControl({
    ...state,
    players,
    nodes,
    lastTickAt: state.lastTickAt ?? now,
  });
}

/**
 * 执行一次游戏 tick。
 * 这是经济系统的核心：每秒被 Host 定时器触发一次。
 * 执行顺序：过期事件 → 触发新事件 → 资源产出 → 控制权判定 → 核心占领计时 → 胜负判定。
 *
 * @param state 当前状态
 * @param now   当前时刻（Unix 毫秒）
 */
export function tickGame(state: GameState, now: number): GameState {
  if (state.phase !== "running") return state;

  const lastTickAt = state.lastTickAt ?? now;
  // 限制单次 tick 最多处理 5 秒的流逝时间（防止长时间断线后追赶异常）
  const elapsedMs = Math.max(0, Math.min(now - lastTickAt, 5000));

  let nextState: GameState = { ...state, lastTickAt: now };

  nextState = expireEvent(nextState, now);
  nextState = maybeStartEvent(nextState, now);
  nextState = addResources(nextState, elapsedMs);
  nextState = resolveNodeControl(nextState);
  nextState = addCoreHold(nextState, elapsedMs);
  nextState = maybeFinish(nextState, now);

  return nextState;
}

/**
 * 重置回大厅。
 * 保留玩家列表和 hostId，清空对局数据，生成新的随机种子。
 */
export function resetToLobby(state: GameState, now: number): GameState {
  const players: Record<PlayerId, Player> = {};
  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (!player) continue;
    players[playerId] = { ...player, resources: 0, coreHoldMs: 0 };
  }

  return {
    ...createInitialGameState(state.roomCode, `${state.seed}:${now}`),
    hostId: state.hostId,
    players,
    playerOrder: state.playerOrder,
    eventLog: [logEntry(now, "房间重置", "上一轮记录已清空，等待新的行动。")],
    snapshotVersion: state.snapshotVersion,
  };
}

// =============================================================================
// 查询与判定函数
// =============================================================================

/**
 * 判断指定据点当前是否可投入。
 * 核心需解锁后才可投入，被 node_lock 事件封锁的据点不可投入。
 */
export function canInvestInNode(state: GameState, nodeId: NodeId, now: number): boolean {
  const node = state.nodes[nodeId];
  if (!node) return false;
  if (node.kind === "core" && !isCoreOpen(state, now)) return false;
  if (state.activeEvent?.type === "node_lock" && state.activeEvent.targetNodeId === nodeId) return false;
  return true;
}

/**
 * 判断核心是否已开放投入。
 * 核心在达到 coreUnlockedAt 时刻或 core_exposed 事件期间开放。
 */
export function isCoreOpen(state: GameState, now: number): boolean {
  if (!state.coreUnlockedAt) return false;
  return now >= state.coreUnlockedAt || state.activeEvent?.type === "core_exposed";
}

/**
 * 计算玩家当前据点得分。
 * 控制保险库（vault）的玩家每个控制的据点额外 +1 分。
 */
export function getPlayerNodeScore(state: GameState, playerId: PlayerId): number {
  return Object.values(state.nodes).reduce((score, node) => {
    if (node.ownerId !== playerId) return score;
    const vaultBonus = ownsBonus(state, playerId, "vault") ? 1 : 0;
    return score + node.baseScore + vaultBonus;
  }, 0);
}

/**
 * 计算获胜候选人排行。
 * 综合得分 = 核心占领秒数 × 3 + 据点分 × 2 + 资源 ÷ 10
 */
export function getWinnerCandidates(state: GameState): WinnerSummary[] {
  return state.playerOrder
    .filter((playerId) => state.players[playerId])
    .map((playerId) => {
      const player = state.players[playerId];
      const nodeScore = getPlayerNodeScore(state, playerId);
      const resourceScore = Math.floor(player.resources / 10);
      const coreScore = Math.floor(player.coreHoldMs / 1000);
      return { playerId, score: coreScore * 3 + nodeScore * 2 + resourceScore };
    })
    .sort((a, b) => b.score - a.score || state.players[b.playerId].resources - state.players[a.playerId].resources);
}

/**
 * 计算玩家当前资源产出速率（情报点/秒）。
 * 基础产出 + 控制据点的产出加成，double_supply 事件期间翻倍。
 */
export function getResourceRate(state: GameState, playerId: PlayerId): number {
  let rate = BASE_RESOURCE_PER_SECOND;
  for (const node of Object.values(state.nodes)) {
    if (node.ownerId !== playerId) continue;
    // outer 据点 income 加成最高
    if (node.kind === "outer") rate += node.bonus === "income" ? 0.45 : 0.24;
    if (node.kind === "relay") rate += 0.18;
    if (node.kind === "core") rate += 0.4;
  }
  // 双倍补给事件翻倍
  if (state.activeEvent?.type === "double_supply") rate *= 2;
  return roundResource(rate);
}

/**
 * 计算玩家在指定据点的有效投入量。
 * 有效投入 = 原始投入 × 权重倍率。
 * 权重受以下因素影响：
 * - 控制攻击（attack）中继站 → 核心投入获得加成
 * - 上一次控制核心 → 防守加权
 * - 控制干扰（disrupt）据点 → 非核心节点投入加成
 * - core_exposed 事件 → 核心投入加成
 * - decoy_intel 事件 → 目标据点投入削弱
 */
export function getEffectiveInvestment(state: GameState, node: MapNode, playerId: PlayerId): number {
  const raw = node.investments[playerId] ?? 0;
  if (raw <= 0) return 0;

  let multiplier = 1;
  if (node.kind === "core") {
    // 核心：进攻加权 × 数量
    if (ownsBonus(state, playerId, "attack")) multiplier += 0.14 * countOwnedBonus(state, playerId, "attack");
    // 上一次控制核心 → 防守加权
    if (node.previousOwnerId === playerId) multiplier += 0.12 * countOwnedBonus(state, playerId, "defense");
    if (state.activeEvent?.type === "core_exposed") multiplier += 0.22;
  } else {
    // 非核心：干扰加权
    if (ownsBonus(state, playerId, "disrupt")) multiplier += 0.08;
  }

  // 假情报事件削弱目标据点
  if (state.activeEvent?.type === "decoy_intel" && state.activeEvent.targetNodeId === node.id) {
    multiplier *= 0.68;
  }

  return raw * multiplier;
}

/**
 * 判断事件是否遮蔽了玩家的投入视野。
 * 通信中断（blackout）期间，未控制扫描（scan）据点的玩家看不到他人的投入细节。
 */
export function eventMasksInvestments(state: GameState, viewerId: PlayerId): boolean {
  if (state.activeEvent?.type !== "blackout") return false;
  return !ownsBonus(state, viewerId, "scan");
}

// =============================================================================
// 内部函数 — 经济与计时
// =============================================================================

/** 根据流逝时间产出资源 */
function addResources(state: GameState, elapsedMs: number): GameState {
  if (elapsedMs <= 0) return state;
  const seconds = elapsedMs / 1000;
  const players: Record<PlayerId, Player> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    players[playerId] = {
      ...player,
      resources: roundResource(player.resources + getResourceRate(state, playerId) * seconds),
    };
  }
  return { ...state, players };
}

/** 累加核心控制计时（仅核心归属玩家） */
function addCoreHold(state: GameState, elapsedMs: number): GameState {
  if (elapsedMs <= 0) return state;
  const core = state.nodes.core;
  if (!core.ownerId || state.phase !== "running") return state;
  const player = state.players[core.ownerId];
  if (!player) return state;

  return {
    ...state,
    players: {
      ...state.players,
      [player.id]: {
        ...player,
        coreHoldMs: player.coreHoldMs + elapsedMs,
      },
    },
  };
}

// =============================================================================
// 内部函数 — 胜负判定
// =============================================================================

/**
 * 检查四种结束条件：
 * 1. 某玩家控制核心达到 CORE_HOLD_TO_WIN_MS → 立即获胜
 * 2. 对局时间耗尽 → 按积分结算
 */
function maybeFinish(state: GameState, now: number): GameState {
  const coreOwnerId = state.nodes.core.ownerId;
  // 条件 1：核心控制足够时间
  if (coreOwnerId && state.players[coreOwnerId]?.coreHoldMs >= CORE_HOLD_TO_WIN_MS) {
    return finishGame(state, coreOwnerId, "核心已被持续控制，行动结束。");
  }

  // 条件 2：时间耗尽
  if (state.startedAt && now - state.startedAt >= MATCH_DURATION_MS) {
    const [winner] = getWinnerCandidates(state);
    return finishGame(state, winner?.playerId ?? null, "行动时间耗尽，按控制记录结算。");
  }

  return state;
}

/** 将游戏设置为 finished 阶段 */
function finishGame(state: GameState, winnerId: PlayerId | null, reason: string): GameState {
  const now = state.lastTickAt ?? Date.now();
  return {
    ...state,
    phase: "finished",
    activeEvent: null,
    winnerId,
    finishReason: reason,
    eventLog: [
      logEntry(now, winnerId ? `${state.players[winnerId]?.codename ?? "未知"} 胜出` : "行动结束", reason),
      ...state.eventLog,
    ].slice(0, MAX_SNAPSHOT_LOG),
  };
}

// =============================================================================
// 内部函数 — 据点控制权
// =============================================================================

/**
 * 按 NODE_ORDER 顺序重新判定所有据点的控制权。
 * 顺序判定使中继站的控制变更能影响同一次 tick 中的核心判定。
 */
function resolveNodeControl(state: GameState): GameState {
  const nodes: Record<NodeId, MapNode> = {} as Record<NodeId, MapNode>;
  for (const nodeId of NODE_ORDER) {
    const node = state.nodes[nodeId];
    const ownerId = resolveOwner(state, node);
    nodes[nodeId] = { ...node, previousOwnerId: node.ownerId, ownerId };
  }
  return { ...state, nodes };
}

/**
 * 判定单个据点的归属。
 * 有效投入量最高者获得控制权；若并列第 1 差距小于 0.001，保持原主不变。
 */
function resolveOwner(state: GameState, node: MapNode): PlayerId | null {
  const ranked = Object.keys(node.investments)
    .filter((playerId) => state.players[playerId])
    .map((playerId) => ({
      playerId,
      value: getEffectiveInvestment(state, node, playerId),
    }))
    .sort((a, b) => b.value - a.value);

  if (!ranked.length || ranked[0].value <= 0) return null;
  // 并列第一差距极小 → 保持原控制者（防止 ping-pong 效应）
  if (ranked.length > 1 && Math.abs(ranked[0].value - ranked[1].value) < 0.001) return node.ownerId;
  return ranked[0].playerId;
}

// =============================================================================
// 内部函数 — 事件系统
// =============================================================================

/** 检查并过期当前事件 */
function expireEvent(state: GameState, now: number): GameState {
  if (!state.activeEvent || state.activeEvent.endsAt > now) return state;
  return {
    ...state,
    activeEvent: null,
    eventLog: [
      logEntry(now, "事件结束", `${state.activeEvent.title} 的影响已经消退。`),
      ...state.eventLog,
    ].slice(0, MAX_SNAPSHOT_LOG),
  };
}

/** 检查条件并触发新事件 */
function maybeStartEvent(state: GameState, now: number): GameState {
  if (!state.startedAt || state.activeEvent) return state;
  const lastEventAt = state.lastEventAt ?? state.startedAt;
  if (now - lastEventAt < EVENT_INTERVAL_MS) return state;

  const event = createEvent(state, now);
  // resource_storm 立即发放资源
  const players = event.type === "resource_storm" ? grantResourceStorm(state.players) : state.players;

  return {
    ...state,
    players,
    activeEvent: event,
    eventCounter: state.eventCounter + 1,
    lastEventAt: now,
    eventLog: [logEntry(now, event.title, event.description), ...state.eventLog].slice(0, MAX_SNAPSHOT_LOG),
  };
}

/** 生成一个随机事件 */
function createEvent(state: GameState, now: number): ActiveEvent {
  const eventType = pickEventType(state);
  const targetNodeId = pickTargetNode(state, eventType);
  const eventId = `${state.roomCode}-${state.eventCounter + 1}`;
  const common = {
    id: eventId,
    type: eventType,
    startedAt: now,
    endsAt: now + EVENT_DURATION_MS,
    targetNodeId,
  };

  // 各事件的标题和描述（中文）
  switch (eventType) {
    case "blackout":
      return { ...common, title: "通信中断", description: "除控制东港线人站的玩家外，节点投入细节暂时被遮蔽。" };
    case "double_supply":
      return { ...common, title: "双倍补给", description: "全员情报点产出翻倍，适合快速改写地图。" };
    case "core_exposed":
      return { ...common, title: "核心暴露", description: "核心加密短暂失效，所有人都可以提前压入核心。" };
    case "decoy_intel":
      return { ...common, title: "假情报", description: `${state.nodes[targetNodeId].shortLabel} 的投入权重被临时削弱。` };
    case "node_lock":
      return { ...common, title: "节点封锁", description: `${state.nodes[targetNodeId].shortLabel} 暂停接收新的投入。` };
    case "resource_storm":
      return { ...common, title: "资源风暴", description: "所有在线玩家立即获得额外情报点。" };
    default:
      return { ...common, title: "异常波动", description: "局势短暂失衡。" };
  }
}

/** 基于种子伪随机选择事件类型 */
function pickEventType(state: GameState): EventType {
  const index = seededIndex(`${state.seed}:${state.eventCounter}:event`, EVENT_TYPES.length);
  return EVENT_TYPES[index];
}

/** 选择事件影响的据点（core_exposed 固定影响核心，其他随机选择非核心据点） */
function pickTargetNode(state: GameState, eventType: EventType): NodeId {
  const candidates = eventType === "core_exposed" ? (["core"] as NodeId[]) : NODE_ORDER.filter((id) => id !== "core");
  return candidates[seededIndex(`${state.seed}:${state.eventCounter}:target`, candidates.length)];
}

/** 资源风暴立即发放额外资源（在线 +14，离线 +5） */
function grantResourceStorm(players: Record<PlayerId, Player>): Record<PlayerId, Player> {
  const next: Record<PlayerId, Player> = {};
  for (const [playerId, player] of Object.entries(players)) {
    next[playerId] = { ...player, resources: roundResource(player.resources + (player.online ? 14 : 5)) };
  }
  return next;
}

// =============================================================================
// 内部工具函数
// =============================================================================

/** 递增快照版本号（每次 Action 处理后调用） */
function bump(state: GameState): GameState {
  return { ...state, snapshotVersion: state.snapshotVersion + 1 };
}

/** Deep clone 初始据点数据（重置投入量和归属） */
function cloneNodes(): Record<NodeId, MapNode> {
  return Object.fromEntries(
    Object.entries(INITIAL_NODES).map(([id, node]) => [
      id,
      { ...node, investments: {}, ownerId: null, previousOwnerId: null },
    ])
  ) as Record<NodeId, MapNode>;
}

/** 检查玩家是否控制至少一个指定 bonus 的据点 */
function ownsBonus(state: GameState, playerId: PlayerId, bonus: MapNode["bonus"]): boolean {
  return Object.values(state.nodes).some((node) => node.ownerId === playerId && node.bonus === bonus);
}

/** 统计玩家控制指定 bonus 的据点数量 */
function countOwnedBonus(state: GameState, playerId: PlayerId, bonus: MapNode["bonus"]): number {
  return Object.values(state.nodes).filter((node) => node.ownerId === playerId && node.bonus === bonus).length;
}

/** 将投入量限制在可用资源范围内 */
function clampInvestment(amount: number, available: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(Math.floor(amount), Math.floor(available)));
}

/** 资源四舍五入到 1 位小数（避免浮点累积误差） */
function roundResource(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

/** FNV-1a 哈希取模 — 将种子字符串映射为 [0, length) 的索引 */
function seededIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % length;
}

/** 创建事件日志条目 */
function logEntry(time: number, title: string, body: string): EventLogEntry {
  return { id: `${time}:${title}`, time, title, body };
}
