import type { EventType, MapNode, NodeId } from "./types";

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS_TO_START = 2;
export const BASE_RESOURCE_PER_SECOND = 1.15;
export const CORE_LOCK_MS = 45_000;
export const CORE_HOLD_TO_WIN_MS = 55_000;
export const MATCH_DURATION_MS = 7 * 60_000;
export const EVENT_INTERVAL_MS = 32_000;
export const EVENT_DURATION_MS = 22_000;
export const STARTING_RESOURCES = 18;
export const MAX_SNAPSHOT_LOG = 9;

export const PLAYER_COLORS = ["#50e6a4", "#f1b84b", "#f26d5b", "#8ca4ff"];

export const CODENAMES = ["渡鸦", "棱镜", "夜航", "回声", "零点", "铁幕", "暗线", "白噪"];

export const NODE_ORDER: NodeId[] = [
  "outer-northwest",
  "relay-north",
  "outer-northeast",
  "relay-west",
  "core",
  "relay-east",
  "outer-southwest",
  "relay-south",
  "outer-southeast",
];

export const EVENT_TYPES: EventType[] = [
  "blackout",
  "double_supply",
  "core_exposed",
  "decoy_intel",
  "node_lock",
  "resource_storm",
];

export const INITIAL_NODES: Record<NodeId, MapNode> = {
  "outer-northwest": {
    id: "outer-northwest",
    label: "北岸暗仓",
    shortLabel: "北岸",
    kind: "outer",
    bonus: "income",
    x: 18,
    y: 16,
    baseScore: 2,
    description: "控制后提高情报点产出。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
  "outer-northeast": {
    id: "outer-northeast",
    label: "东港线人站",
    shortLabel: "东港",
    kind: "outer",
    bonus: "scan",
    x: 78,
    y: 15,
    baseScore: 2,
    description: "控制后削弱通信中断影响。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
  "outer-southwest": {
    id: "outer-southwest",
    label: "西郊干扰塔",
    shortLabel: "西郊",
    kind: "outer",
    bonus: "disrupt",
    x: 20,
    y: 82,
    baseScore: 2,
    description: "控制后提升非核心节点争夺权重。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
  "outer-southeast": {
    id: "outer-southeast",
    label: "南站保险库",
    shortLabel: "南站",
    kind: "outer",
    bonus: "vault",
    x: 80,
    y: 80,
    baseScore: 2,
    description: "控制后在结算中获得额外据点分。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
  "relay-north": {
    id: "relay-north",
    label: "北部中继",
    shortLabel: "北继",
    kind: "relay",
    bonus: "attack",
    x: 50,
    y: 22,
    baseScore: 3,
    description: "控制后提升核心进攻权重。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
  "relay-east": {
    id: "relay-east",
    label: "东部中继",
    shortLabel: "东继",
    kind: "relay",
    bonus: "attack",
    x: 67,
    y: 50,
    baseScore: 3,
    description: "控制后提升核心进攻权重。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
  "relay-south": {
    id: "relay-south",
    label: "南部中继",
    shortLabel: "南继",
    kind: "relay",
    bonus: "defense",
    x: 50,
    y: 70,
    baseScore: 3,
    description: "控制后巩固核心防守权重。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
  "relay-west": {
    id: "relay-west",
    label: "西部中继",
    shortLabel: "西继",
    kind: "relay",
    bonus: "defense",
    x: 33,
    y: 50,
    baseScore: 3,
    description: "控制后巩固核心防守权重。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
  core: {
    id: "core",
    label: "中央信标核心",
    shortLabel: "核心",
    kind: "core",
    bonus: "income",
    x: 50,
    y: 48,
    baseScore: 8,
    description: "持续控制即可赢下整局。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
};

export const MAP_LINKS: Array<[NodeId, NodeId]> = [
  ["outer-northwest", "relay-north"],
  ["outer-northeast", "relay-north"],
  ["outer-southwest", "relay-south"],
  ["outer-southeast", "relay-south"],
  ["outer-northwest", "relay-west"],
  ["outer-southwest", "relay-west"],
  ["outer-northeast", "relay-east"],
  ["outer-southeast", "relay-east"],
  ["relay-north", "core"],
  ["relay-east", "core"],
  ["relay-south", "core"],
  ["relay-west", "core"],
];
