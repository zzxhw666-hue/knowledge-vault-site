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

export interface CharacterProfile {
  id: string;
  name: string;
  color: string;
  traitTitle: string;
  traitDescription: string;
  stats: {
    moveSpeed: number;
    dashDistance: number;
    fireCost: number;
    damage: number;
    energyRegen: number;
    projectileSpeed: number;
    healing: number;
    extraProjectiles: number;
    maxHp: number;
  };
}

export const CHARACTER_PROFILES: CharacterProfile[] = [
  {
    id: "mender",
    name: "绿洲修复者",
    color: "#50e6a4",
    traitTitle: "自愈协议",
    traitDescription: "核心回血更快，能量恢复略高。",
    stats: {
      moveSpeed: 1,
      dashDistance: 1,
      fireCost: 1,
      damage: 0.95,
      energyRegen: 1.1,
      projectileSpeed: 1,
      healing: 1.35,
      extraProjectiles: 0,
      maxHp: 100,
    },
  },
  {
    id: "breacher",
    name: "金焰破门手",
    color: "#f1b84b",
    traitTitle: "重载脉冲",
    traitDescription: "子弹伤害更高，但开火消耗略高。",
    stats: {
      moveSpeed: 0.96,
      dashDistance: 0.95,
      fireCost: 1.12,
      damage: 1.22,
      energyRegen: 1,
      projectileSpeed: 0.94,
      healing: 1,
      extraProjectiles: 0,
      maxHp: 100,
    },
  },
  {
    id: "runner",
    name: "赤锋突袭者",
    color: "#f26d5b",
    traitTitle: "高速切入",
    traitDescription: "移动和冲刺更快，适合抢道具和绕后。",
    stats: {
      moveSpeed: 1.14,
      dashDistance: 1.18,
      fireCost: 0.98,
      damage: 1,
      energyRegen: 0.96,
      projectileSpeed: 1.04,
      healing: 1,
      extraProjectiles: 0,
      maxHp: 100,
    },
  },
  {
    id: "prism",
    name: "蓝棱折射师",
    color: "#8ca4ff",
    traitTitle: "折射枪口",
    traitDescription: "开局额外发射 1 枚低伤害子弹。",
    stats: {
      moveSpeed: 0.98,
      dashDistance: 1,
      fireCost: 1.04,
      damage: 0.82,
      energyRegen: 1,
      projectileSpeed: 1.08,
      healing: 1,
      extraProjectiles: 1,
      maxHp: 100,
    },
  },
];

export const PLAYER_COLORS = CHARACTER_PROFILES.map((profile) => profile.color);

export function getCharacterProfile(color: string): CharacterProfile {
  return CHARACTER_PROFILES.find((profile) => profile.color === color) ?? CHARACTER_PROFILES[0];
}

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
