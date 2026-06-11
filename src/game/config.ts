/**
 * 游戏常量配置模块。
 *
 * 包含两种游戏模式的所有数值参数：
 * 1. 「情报暗战」策略推演模式 — 经济、计时、事件相关常量
 * 2. 「角色竞技场」实时对战模式 — 角色属性、操作消耗相关常量
 *
 * 同时定义地图数据（据点坐标与连接关系）和 UI 辅助数据。
 */
import type { EventType, MapNode, NodeId } from "./types";

// =============================================================================
// 「情报暗战」策略模式常量
// =============================================================================

/** 房间最大玩家数 */
export const MAX_PLAYERS = 4;

/** 开局最少所需玩家数 */
export const MIN_PLAYERS_TO_START = 2;

/** 基础情报点产出速率（每秒） */
export const BASE_RESOURCE_PER_SECOND = 1.15;

/** 核心初始锁定时间（毫秒），在此期间核心不可投入 */
export const CORE_LOCK_MS = 45_000;

/** 持续控制核心后获胜所需时间（毫秒） */
export const CORE_HOLD_TO_WIN_MS = 55_000;

/** 单局最大时长（毫秒），7 分钟 */
export const MATCH_DURATION_MS = 7 * 60_000;

/** 事件触发间隔（毫秒） */
export const EVENT_INTERVAL_MS = 32_000;

/** 事件持续时间（毫秒） */
export const EVENT_DURATION_MS = 22_000;

/** 玩家初始情报点 */
export const STARTING_RESOURCES = 18;

/** 事件日志最大保留条目数 */
export const MAX_SNAPSHOT_LOG = 9;

// =============================================================================
// 「角色竞技场」角色配置
// =============================================================================

/** 角色档案接口 */
export interface CharacterProfile {
  /** 角色唯一标识符 */
  id: string;
  /** 角色中文名 */
  name: string;
  /** 角色色调（十六进制色值） */
  color: string;
  /** 特性标题（简短描述） */
  traitTitle: string;
  /** 特性详细描述 */
  traitDescription: string;
  /** 角色属性值（倍率，1.0 为基准） */
  stats: {
    /** 移动速度倍率 */
    moveSpeed: number;
    /** 冲刺距离倍率 */
    dashDistance: number;
    /** 射击能量消耗倍率 */
    fireCost: number;
    /** 弹丸伤害倍率 */
    damage: number;
    /** 能量恢复速率倍率 */
    energyRegen: number;
    /** 弹丸飞行速度倍率 */
    projectileSpeed: number;
    /** 核心区域回血倍率 */
    healing: number;
    /** 额外弹丸数（初始） */
    extraProjectiles: number;
    /** 最大生命值 */
    maxHp: number;
  };
}

/**
 * 四名可选角色配置。
 * 每个角色有不同的属性偏向，形成差异化玩法：
 * - 绿洲修复者：高回血，适合防守核心
 * - 金焰破门手：高伤害，但消耗也高
 * - 赤锋突袭者：高机动性，适合游走拾取道具
 * - 蓝棱折射师：额外弹丸，面伤输出
 */
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

/** 玩家可选颜色列表（与角色一一对应） */
export const PLAYER_COLORS = CHARACTER_PROFILES.map((profile) => profile.color);

/**
 * 根据颜色查找角色档案。
 * 颜色是角色的唯一视觉标识，用于跨网络同步角色属性。
 *
 * @param color 十六进制色值
 * @returns 匹配的 CharacterProfile，未找到时返回默认角色
 */
export function getCharacterProfile(color: string): CharacterProfile {
  return CHARACTER_PROFILES.find((profile) => profile.color === color) ?? CHARACTER_PROFILES[0];
}

/** 行动代号候选列表（玩家可在大厅中选择） */
export const CODENAMES = ["渡鸦", "棱镜", "夜航", "回声", "零点", "铁幕", "暗线", "白噪"];

// =============================================================================
// 「情报暗战」地图数据
// =============================================================================

/**
 * 据点处理顺序。
 * 控制权判定按此顺序进行：先判定外围 → 中继 → 核心，
 * 使中继站的防守加权能影响核心结果。
 */
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

/** 所有可能的事件类型（用于种子随机选择） */
export const EVENT_TYPES: EventType[] = [
  "blackout",
  "double_supply",
  "core_exposed",
  "decoy_intel",
  "node_lock",
  "resource_storm",
];

/**
 * 初始据点配置（每次对局会 deep clone 此对象）。
 * 9 个据点组成 3×3 网格布局，坐标使用百分比定位。
 */
export const INITIAL_NODES: Record<NodeId, MapNode> = {
  "outer-northwest": {
    id: "outer-northwest",
    label: "北岸暗仓",
    shortLabel: "北岸",
    kind: "outer",
    bonus: "income",
    x: 18, y: 16,
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
    x: 78, y: 15,
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
    x: 20, y: 82,
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
    x: 80, y: 80,
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
    x: 50, y: 22,
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
    x: 67, y: 50,
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
    x: 50, y: 70,
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
    x: 33, y: 50,
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
    x: 50, y: 48,
    baseScore: 8,
    description: "持续控制即可赢下整局。",
    investments: {},
    ownerId: null,
    previousOwnerId: null,
  },
};

/**
 * 据点连接关系。
 * 定义地图上各据点之间的邻接边，用于可视化网络连线。
 * 每个外围据点连接两个相邻的中继站，中继站连接核心。
 */
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
