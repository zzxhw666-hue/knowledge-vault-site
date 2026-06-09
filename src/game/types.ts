export type PlayerId = string;

export type NodeId =
  | "outer-northwest"
  | "outer-northeast"
  | "outer-southwest"
  | "outer-southeast"
  | "relay-north"
  | "relay-east"
  | "relay-south"
  | "relay-west"
  | "core";

export type NodeKind = "outer" | "relay" | "core";

export type NodeBonus = "income" | "attack" | "defense" | "scan" | "disrupt" | "vault";

export type GamePhase = "lobby" | "running" | "finished";

export type EventType =
  | "blackout"
  | "double_supply"
  | "core_exposed"
  | "decoy_intel"
  | "node_lock"
  | "resource_storm";

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  codename: string;
  joinedAt: number;
  resources: number;
  coreHoldMs: number;
  online: boolean;
}

export interface MapNode {
  id: NodeId;
  label: string;
  shortLabel: string;
  kind: NodeKind;
  bonus: NodeBonus;
  x: number;
  y: number;
  baseScore: number;
  description: string;
  investments: Record<PlayerId, number>;
  ownerId: PlayerId | null;
  previousOwnerId: PlayerId | null;
}

export interface ActiveEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  startedAt: number;
  endsAt: number;
  targetNodeId?: NodeId;
}

export interface EventLogEntry {
  id: string;
  time: number;
  title: string;
  body: string;
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  hostId: PlayerId | null;
  players: Record<PlayerId, Player>;
  playerOrder: PlayerId[];
  nodes: Record<NodeId, MapNode>;
  activeEvent: ActiveEvent | null;
  eventLog: EventLogEntry[];
  startedAt: number | null;
  lastTickAt: number | null;
  lastEventAt: number | null;
  coreUnlockedAt: number | null;
  eventCounter: number;
  snapshotVersion: number;
  seed: string;
  winnerId: PlayerId | null;
  finishReason: string | null;
}

export interface PresencePlayer {
  id: PlayerId;
  name: string;
  color: string;
  codename: string;
  joinedAt: number;
}

export interface InvestIntent {
  playerId: PlayerId;
  nodeId: NodeId;
  amount: number;
  intentId: string;
  sentAt: number;
}

export type GameAction =
  | { type: "syncPlayers"; players: PresencePlayer[]; hostId: PlayerId | null; now: number }
  | { type: "startGame"; now: number }
  | { type: "invest"; intent: InvestIntent; now: number }
  | { type: "tick"; now: number }
  | { type: "resetToLobby"; now: number };

export interface WinnerSummary {
  playerId: PlayerId;
  score: number;
}
