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

export function syncPlayers(state: GameState, presencePlayers: PresencePlayer[], hostId: PlayerId | null, now: number): GameState {
  const uniquePlayers = [...new Map(presencePlayers.map((player) => [player.id, player])).values()]
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
    .slice(0, MAX_PLAYERS);
  const onlineIds = new Set(uniquePlayers.map((player) => player.id));
  const players: Record<PlayerId, Player> = { ...state.players };

  for (const presencePlayer of uniquePlayers) {
    const previous = players[presencePlayer.id];
    players[presencePlayer.id] = {
      id: presencePlayer.id,
      name: presencePlayer.name,
      color: presencePlayer.color,
      codename: presencePlayer.codename,
      joinedAt: presencePlayer.joinedAt,
      resources: previous?.resources ?? (state.phase === "running" ? STARTING_RESOURCES : 0),
      coreHoldMs: previous?.coreHoldMs ?? 0,
      online: true,
    };
  }

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
    coreUnlockedAt: now + CORE_LOCK_MS,
    eventCounter: 0,
    winnerId: null,
    finishReason: null,
  };
}

export function applyInvest(state: GameState, intent: InvestIntent, now: number): GameState {
  if (state.phase !== "running") return state;
  const player = state.players[intent.playerId];
  const node = state.nodes[intent.nodeId];
  if (!player || !player.online || !node) return state;
  if (!canInvestInNode(state, intent.nodeId, now)) return state;

  const amount = clampInvestment(intent.amount, player.resources);
  if (amount <= 0) return state;

  const players = {
    ...state.players,
    [player.id]: {
      ...player,
      resources: roundResource(player.resources - amount),
    },
  };

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

  return resolveNodeControl({
    ...state,
    players,
    nodes,
    lastTickAt: state.lastTickAt ?? now,
  });
}

export function tickGame(state: GameState, now: number): GameState {
  if (state.phase !== "running") return state;
  const lastTickAt = state.lastTickAt ?? now;
  const elapsedMs = Math.max(0, Math.min(now - lastTickAt, 5000));
  let nextState: GameState = {
    ...state,
    lastTickAt: now,
  };

  nextState = expireEvent(nextState, now);
  nextState = maybeStartEvent(nextState, now);
  nextState = addResources(nextState, elapsedMs);
  nextState = resolveNodeControl(nextState);
  nextState = addCoreHold(nextState, elapsedMs);
  nextState = maybeFinish(nextState, now);

  return nextState;
}

export function resetToLobby(state: GameState, now: number): GameState {
  const players: Record<PlayerId, Player> = {};
  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (!player) continue;
    players[playerId] = {
      ...player,
      resources: 0,
      coreHoldMs: 0,
    };
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

export function canInvestInNode(state: GameState, nodeId: NodeId, now: number): boolean {
  const node = state.nodes[nodeId];
  if (!node) return false;
  if (node.kind === "core" && !isCoreOpen(state, now)) return false;
  if (state.activeEvent?.type === "node_lock" && state.activeEvent.targetNodeId === nodeId) return false;
  return true;
}

export function isCoreOpen(state: GameState, now: number): boolean {
  if (!state.coreUnlockedAt) return false;
  return now >= state.coreUnlockedAt || state.activeEvent?.type === "core_exposed";
}

export function getPlayerNodeScore(state: GameState, playerId: PlayerId): number {
  return Object.values(state.nodes).reduce((score, node) => {
    if (node.ownerId !== playerId) return score;
    const vaultBonus = ownsBonus(state, playerId, "vault") ? 1 : 0;
    return score + node.baseScore + vaultBonus;
  }, 0);
}

export function getWinnerCandidates(state: GameState): WinnerSummary[] {
  return state.playerOrder
    .filter((playerId) => state.players[playerId])
    .map((playerId) => {
      const player = state.players[playerId];
      const nodeScore = getPlayerNodeScore(state, playerId);
      const resourceScore = Math.floor(player.resources / 10);
      const coreScore = Math.floor(player.coreHoldMs / 1000);
      return {
        playerId,
        score: coreScore * 3 + nodeScore * 2 + resourceScore,
      };
    })
    .sort((a, b) => b.score - a.score || state.players[b.playerId].resources - state.players[a.playerId].resources);
}

export function getResourceRate(state: GameState, playerId: PlayerId): number {
  let rate = BASE_RESOURCE_PER_SECOND;
  for (const node of Object.values(state.nodes)) {
    if (node.ownerId !== playerId) continue;
    if (node.kind === "outer") rate += node.bonus === "income" ? 0.45 : 0.24;
    if (node.kind === "relay") rate += 0.18;
    if (node.kind === "core") rate += 0.4;
  }
  if (state.activeEvent?.type === "double_supply") rate *= 2;
  return roundResource(rate);
}

export function getEffectiveInvestment(state: GameState, node: MapNode, playerId: PlayerId): number {
  const raw = node.investments[playerId] ?? 0;
  if (raw <= 0) return 0;

  let multiplier = 1;
  if (node.kind === "core") {
    if (ownsBonus(state, playerId, "attack")) multiplier += 0.14 * countOwnedBonus(state, playerId, "attack");
    if (node.previousOwnerId === playerId) multiplier += 0.12 * countOwnedBonus(state, playerId, "defense");
    if (state.activeEvent?.type === "core_exposed") multiplier += 0.22;
  } else {
    if (ownsBonus(state, playerId, "disrupt")) multiplier += 0.08;
  }

  if (state.activeEvent?.type === "decoy_intel" && state.activeEvent.targetNodeId === node.id) {
    multiplier *= 0.68;
  }

  return raw * multiplier;
}

export function eventMasksInvestments(state: GameState, viewerId: PlayerId): boolean {
  if (state.activeEvent?.type !== "blackout") return false;
  return !ownsBonus(state, viewerId, "scan");
}

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
  return {
    ...state,
    players,
  };
}

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

function maybeFinish(state: GameState, now: number): GameState {
  const coreOwnerId = state.nodes.core.ownerId;
  if (coreOwnerId && state.players[coreOwnerId]?.coreHoldMs >= CORE_HOLD_TO_WIN_MS) {
    return finishGame(state, coreOwnerId, "核心已被持续控制，行动结束。");
  }

  if (state.startedAt && now - state.startedAt >= MATCH_DURATION_MS) {
    const [winner] = getWinnerCandidates(state);
    return finishGame(state, winner?.playerId ?? null, "行动时间耗尽，按控制记录结算。");
  }

  return state;
}

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

function resolveNodeControl(state: GameState): GameState {
  const nodes: Record<NodeId, MapNode> = {} as Record<NodeId, MapNode>;
  for (const nodeId of NODE_ORDER) {
    const node = state.nodes[nodeId];
    const ownerId = resolveOwner(state, node);
    nodes[nodeId] = {
      ...node,
      previousOwnerId: node.ownerId,
      ownerId,
    };
  }
  return {
    ...state,
    nodes,
  };
}

function resolveOwner(state: GameState, node: MapNode): PlayerId | null {
  const ranked = Object.keys(node.investments)
    .filter((playerId) => state.players[playerId])
    .map((playerId) => ({
      playerId,
      value: getEffectiveInvestment(state, node, playerId),
    }))
    .sort((a, b) => b.value - a.value);

  if (!ranked.length || ranked[0].value <= 0) return null;
  if (ranked.length > 1 && Math.abs(ranked[0].value - ranked[1].value) < 0.001) return node.ownerId;
  return ranked[0].playerId;
}

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

function maybeStartEvent(state: GameState, now: number): GameState {
  if (!state.startedAt || state.activeEvent) return state;
  const lastEventAt = state.lastEventAt ?? state.startedAt;
  if (now - lastEventAt < EVENT_INTERVAL_MS) return state;
  const event = createEvent(state, now);
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

  switch (eventType) {
    case "blackout":
      return {
        ...common,
        title: "通信中断",
        description: "除控制东港线人站的玩家外，节点投入细节暂时被遮蔽。",
      };
    case "double_supply":
      return {
        ...common,
        title: "双倍补给",
        description: "全员情报点产出翻倍，适合快速改写地图。",
      };
    case "core_exposed":
      return {
        ...common,
        title: "核心暴露",
        description: "核心加密短暂失效，所有人都可以提前压入核心。",
      };
    case "decoy_intel":
      return {
        ...common,
        title: "假情报",
        description: `${state.nodes[targetNodeId].shortLabel} 的投入权重被临时削弱。`,
      };
    case "node_lock":
      return {
        ...common,
        title: "节点封锁",
        description: `${state.nodes[targetNodeId].shortLabel} 暂停接收新的投入。`,
      };
    case "resource_storm":
      return {
        ...common,
        title: "资源风暴",
        description: "所有在线玩家立即获得额外情报点。",
      };
    default:
      return {
        ...common,
        title: "异常波动",
        description: "局势短暂失衡。",
      };
  }
}

function pickEventType(state: GameState): EventType {
  const index = seededIndex(`${state.seed}:${state.eventCounter}:event`, EVENT_TYPES.length);
  return EVENT_TYPES[index];
}

function pickTargetNode(state: GameState, eventType: EventType): NodeId {
  const candidates = eventType === "core_exposed" ? (["core"] as NodeId[]) : NODE_ORDER.filter((id) => id !== "core");
  return candidates[seededIndex(`${state.seed}:${state.eventCounter}:target`, candidates.length)];
}

function grantResourceStorm(players: Record<PlayerId, Player>): Record<PlayerId, Player> {
  const next: Record<PlayerId, Player> = {};
  for (const [playerId, player] of Object.entries(players)) {
    next[playerId] = {
      ...player,
      resources: roundResource(player.resources + (player.online ? 14 : 5)),
    };
  }
  return next;
}

function bump(state: GameState): GameState {
  return {
    ...state,
    snapshotVersion: state.snapshotVersion + 1,
  };
}

function cloneNodes(): Record<NodeId, MapNode> {
  return Object.fromEntries(
    Object.entries(INITIAL_NODES).map(([id, node]) => [
      id,
      {
        ...node,
        investments: {},
        ownerId: null,
        previousOwnerId: null,
      },
    ])
  ) as Record<NodeId, MapNode>;
}

function ownsBonus(state: GameState, playerId: PlayerId, bonus: MapNode["bonus"]): boolean {
  return Object.values(state.nodes).some((node) => node.ownerId === playerId && node.bonus === bonus);
}

function countOwnedBonus(state: GameState, playerId: PlayerId, bonus: MapNode["bonus"]): number {
  return Object.values(state.nodes).filter((node) => node.ownerId === playerId && node.bonus === bonus).length;
}

function clampInvestment(amount: number, available: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(Math.floor(amount), Math.floor(available)));
}

function roundResource(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

function seededIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % length;
}

function logEntry(time: number, title: string, body: string): EventLogEntry {
  return {
    id: `${time}:${title}`,
    time,
    title,
    body,
  };
}
