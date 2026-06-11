/**
 * 「角色竞技场」实时对战模式 — 物理与战斗引擎。
 *
 * 这是竞技场的核心模块，包含：
 * 1. 角色（ArenaAgent）的创建、移动、碰撞、受伤、重生
 * 2. 弹丸（ArenaShot）的创建、飞行、碰撞反弹、过期
 * 3. 升级道具（ArenaUpgrade）的生成、拾取判定
 * 4. 网络信号（ArenaSignal）的类型定义
 * 5. 战场区域（ArenaZone）的布局定义
 *
 * 坐标系统使用百分比（0–100），由 CSS 渲染为实际像素。
 * 所有物理计算基于百分比坐标，与屏幕分辨率解耦。
 */
import type { PresencePlayer } from "./types";
import { getCharacterProfile } from "./config";

// =============================================================================
// 实体类型定义
// =============================================================================

/**
 * 竞技场中的玩家角色。
 * 扩展 PresencePlayer，增加战斗属性。
 */
export interface ArenaAgent extends PresencePlayer {
  /** X 坐标（百分比，0–100） */
  x: number;
  /** Y 坐标（百分比，0–100） */
  y: number;
  /** 朝向角度（弧度），0 = 右，π/2 = 下 */
  angle: number;
  /** 当前生命值 */
  hp: number;
  /** 当前共用能量（0–100），用于射击和冲刺 */
  energy: number;
  /** 核心上传得分 */
  score: number;
  /** 击杀数 */
  kills: number;
  /** 死亡数 */
  deaths: number;
  /** 是否激活 Overdrive 形态（体积增大，近身秒杀） */
  isOverdrive: boolean;
  /** 当前动作状态（影响渲染动画） */
  action: "idle" | "move" | "fire" | "dash" | "capture" | "hit" | "heal" | "down";
  /** 最后更新时刻（Unix 毫秒） */
  updatedAt: number;
}

/**
 * 弹丸（飞行中的子弹）。
 * 支持 1 次边界/掩体反弹，有生命周期限制。
 */
export interface ArenaShot {
  /** 弹丸唯一标识符 */
  id: string;
  /** 发射者 ID */
  shooterId: string;
  /** 目标 ID（保留字段，当前未使用） */
  targetId: string | null;
  /** 上一帧 X 坐标（用于绘制拖尾） */
  previousX: number;
  /** 上一帧 Y 坐标 */
  previousY: number;
  /** 当前 X 坐标 */
  x: number;
  /** 当前 Y 坐标 */
  y: number;
  /** 当前飞行角度（弧度） */
  angle: number;
  /** X 方向速度分量 */
  vx: number;
  /** Y 方向速度分量 */
  vy: number;
  /** 弹丸伤害值 */
  damage: number;
  /** 剩余反弹次数 */
  bouncesLeft: number;
  /** 发射时刻（Unix 毫秒） */
  time: number;
}

/**
 * 升级道具。
 * 从固定出生点周期性生成，玩家走近即可拾取。
 */
export interface ArenaUpgrade {
  /** 道具唯一标识符 */
  id: string;
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
  /** 道具类型 */
  kind: "splitter" | "medkit" | "battery" | "haste" | "guard";
  /** 道具标签（中文） */
  label: string;
  /** 生成时刻 */
  spawnedAt: number;
  /** 过期时刻 */
  expiresAt: number;
}

/**
 * 网络信号（竞技场专用）。
 * 通过 Supabase Broadcast 在客户端间实时同步。
 */
export type ArenaSignal =
  | { type: "agent"; agent: ArenaAgent }                                          // 角色状态同步
  | { type: "shot"; shot: ArenaShot }                                              // 弹丸发射
  | { type: "score"; playerId: string; score: number; time: number }               // 核心上传得分
  | { type: "room-start"; startedBy: string; startedAt: number }                   // 房主开始对局
  | { type: "upgrade-spawn"; upgrade: ArenaUpgrade }                               // 道具生成
  | { type: "upgrade-collect"; upgradeId: string; playerId: string; time: number } // 道具拾取
  | { type: "damage"; targetId: string; shooterId: string; shotId: string; damage: number; time: number } // 伤害同步
  | { type: "elimination"; killerId: string; targetId: string; time: number }      // 击杀事件
  | { type: "game-over"; winnerId: string; time: number };                         // 对局结束

/** 战场区域 */
export interface ArenaZone {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  /** 区域类型：core（可穿越/占领）、relay（不可穿越）、cover（掩体） */
  kind: "core" | "relay" | "cover";
}

// =============================================================================
// 竞技场物理常量
// =============================================================================

/** 战场宽度（百分比坐标） */
export const ARENA_WIDTH = 100;

/** 战场高度（百分比坐标） */
export const ARENA_HEIGHT = 100;

/** 角色碰撞半径（百分比） */
export const AGENT_RADIUS = 3.2;

/** 基础移动速度（百分比/秒） */
export const MOVE_SPEED = 28;

/** 基础冲刺距离（百分比） */
export const DASH_DISTANCE = 12;

/** 冲刺能量消耗 */
export const DASH_COST = 28;

/** 射击基础能量消耗 */
export const FIRE_COST = 12;

/** 射击最大射程（百分比） */
export const FIRE_RANGE = 38;

/** 射击散射角（度） */
export const FIRE_ARC_DEGREES = 12;

/** 基础弹丸伤害 */
export const FIRE_DAMAGE = 28;

/** 弹丸飞行速度（百分比/秒） */
export const PROJECTILE_SPEED = 76;

/** 弹丸碰撞半径 */
export const PROJECTILE_RADIUS = 1.35;

/** 弹丸最大反弹次数 */
export const PROJECTILE_BOUNCES = 1;

/** 弹丸存续时间（毫秒） */
export const PROJECTILE_LIFETIME_MS = 2200;

/** 核心区域回血速率（HP/秒） */
export const CORE_HEAL_PER_SECOND = 20;

/** 道具生成间隔（毫秒） */
export const UPGRADE_SPAWN_INTERVAL_MS = 10_000;

/** 道具存续时间（毫秒） */
export const UPGRADE_LIFETIME_MS = 18_000;

/** 道具拾取半径 */
export const UPGRADE_RADIUS = 2.6;

/** 武器最高弹丸升级数 */
export const MAX_WEAPON_UPGRADES = 4;

/** 开始对局最少玩家数 */
export const MIN_ARENA_PLAYERS_TO_START = 2;

/** 获胜所需击杀数 */
export const KILL_LIMIT = 20;

/** Overdrive 形态体积倍率 */
export const OVERDRIVE_RADIUS_MULTIPLIER = 2.25;

/** 共用能量恢复速率（百分比/秒） */
export const ENERGY_REGEN_PER_SECOND = 18;

/** 核心占领区半径 */
export const CAPTURE_RADIUS = 10;

/** 核心上传所需持续站立时间（秒） */
export const CAPTURE_SECONDS = 4.2;

// =============================================================================
// 战场区域布局
// =============================================================================

/**
 * 战场上的 7 个固定区域。
 * 1 个核心（可穿透、可占领）、4 个中继站（固体障碍物）、2 个掩体。
 */
export const ARENA_ZONES: ArenaZone[] = [
  { id: "core",        label: "中央信标", x: 50, y: 50, radius: CAPTURE_RADIUS, kind: "core" },
  { id: "north-relay", label: "北部中继", x: 50, y: 18, radius: 6, kind: "relay" },
  { id: "east-relay",  label: "东部中继", x: 79, y: 50, radius: 6, kind: "relay" },
  { id: "south-relay", label: "南部中继", x: 50, y: 82, radius: 6, kind: "relay" },
  { id: "west-relay",  label: "西部中继", x: 21, y: 50, radius: 6, kind: "relay" },
  { id: "cover-a",     label: "掩体",     x: 30, y: 30, radius: 5, kind: "cover" },
  { id: "cover-b",     label: "掩体",     x: 70, y: 70, radius: 5, kind: "cover" },
];

/** 道具生成点（10 个预设位置，围绕地图边缘和中心） */
const UPGRADE_SPAWN_POINTS = [
  { x: 38, y: 18 },
  { x: 62, y: 18 },
  { x: 84, y: 32 },
  { x: 78, y: 68 },
  { x: 62, y: 88 },
  { x: 38, y: 88 },
  { x: 16, y: 68 },
  { x: 22, y: 32 },
  { x: 42, y: 44 },
  { x: 58, y: 56 },
];

/** 5 种可拾取道具类型 */
const UPGRADE_KINDS: Array<Pick<ArenaUpgrade, "kind" | "label">> = [
  { kind: "splitter", label: "+1 弹道" },
  { kind: "medkit",   label: "急救包" },
  { kind: "battery",  label: "能量包" },
  { kind: "haste",    label: "疾行包" },
  { kind: "guard",    label: "护盾包" },
];

// =============================================================================
// 角色创建与物理
// =============================================================================

/**
 * 创建竞技场角色。
 * 从出生点初始化位置、满血满能量的战斗状态。
 *
 * @param player Presence 玩家信息
 * @param now    当前时刻
 * @param offset 出生点偏移（用于多玩家不同出生点）
 */
export function createArenaAgent(player: PresencePlayer, now: number, offset = 0): ArenaAgent {
  const spawn = getSpawnPoint(offset);
  const profile = getCharacterProfile(player.color);
  return {
    ...player,
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    hp: profile.stats.maxHp,
    energy: 100,
    score: 0,
    kills: 0,
    deaths: 0,
    isOverdrive: false,
    action: "idle",
    updatedAt: now,
  };
}

/**
 * 将角色夹持到战场边界内和属性范围内。
 * 防止角色穿墙或 HP/能量越界。
 */
export function clampAgent(agent: ArenaAgent): ArenaAgent {
  const profile = getCharacterProfile(agent.color);
  return {
    ...agent,
    x: clamp(agent.x, AGENT_RADIUS, ARENA_WIDTH - AGENT_RADIUS),
    y: clamp(agent.y, AGENT_RADIUS, ARENA_HEIGHT - AGENT_RADIUS),
    hp: clamp(agent.hp, 0, profile.stats.maxHp),
    energy: clamp(agent.energy, 0, 100),
  };
}

/**
 * 解析角色与固体障碍物的碰撞。
 * 将角色推出所有 solid 区域（中继站和掩体），同时夹持到战场边界内。
 */
export function resolveAgentCollision(agent: ArenaAgent): ArenaAgent {
  let next = clampAgent(agent);

  for (const zone of getSolidZones()) {
    const dx = next.x - zone.x;
    const dy = next.y - zone.y;
    const currentDistance = Math.hypot(dx, dy);
    const minimumDistance = zone.radius + AGENT_RADIUS;

    // 角色未进入该区域则跳过
    if (currentDistance >= minimumDistance) continue;

    // 计算推出方向（从区域中心指向角色）
    const nx = currentDistance > 0 ? dx / currentDistance : 1;
    const ny = currentDistance > 0 ? dy / currentDistance : 0;
    next = clampAgent({
      ...next,
      x: zone.x + nx * minimumDistance,
      y: zone.y + ny * minimumDistance,
    });
  }

  return next;
}

/**
 * 计算两点之间的欧几里得距离。
 */
export function distance(a: Pick<ArenaAgent, "x" | "y">, b: Pick<ArenaAgent, "x" | "y">) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 计算从 from 指向 to 的方向角（弧度）。
 */
export function angleTo(from: Pick<ArenaAgent, "x" | "y">, to: Pick<ArenaAgent, "x" | "y">) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// =============================================================================
// 弹丸系统
// =============================================================================

/**
 * 在目标列表中寻找最佳射击目标。
 * 条件：在射程内 + 在射击角度锥形内 + 最近距离优先。
 *
 * @returns 最佳目标，或 null（无合法目标）
 */
export function findShotTarget(shooter: ArenaAgent, targets: ArenaAgent[]) {
  let bestTarget: ArenaAgent | null = null;
  let bestDistance = Infinity;
  const maxArc = degreesToRadians(FIRE_ARC_DEGREES);

  for (const target of targets) {
    if (target.id === shooter.id || target.hp <= 0) continue;
    const range = distance(shooter, target);
    if (range > FIRE_RANGE || range >= bestDistance) continue;

    const delta = Math.abs(shortestAngleDelta(shooter.angle, angleTo(shooter, target)));
    if (delta > maxArc) continue;

    bestTarget = target;
    bestDistance = range;
  }

  return bestTarget;
}

/**
 * 创建一枚弹丸。
 * 从射手位置沿指定方向发射，应用角色属性倍率。
 *
 * @param shooter 射手
 * @param id      弹丸唯一标识
 * @param now     发射时刻
 * @param options 角度偏移、速度倍率、伤害倍率
 */
export function createProjectile(
  shooter: ArenaAgent,
  id: string,
  now: number,
  options: {
    angleOffset?: number;       // 散射角度偏移（弧度）
    speedMultiplier?: number;   // 速度倍率
    damageMultiplier?: number;  // 伤害倍率
  } = {}
): ArenaShot {
  const profile = getCharacterProfile(shooter.color);
  const angle = shooter.angle + (options.angleOffset ?? 0);
  const speed = PROJECTILE_SPEED * profile.stats.projectileSpeed * (options.speedMultiplier ?? 1);
  const damage = FIRE_DAMAGE * profile.stats.damage * (options.damageMultiplier ?? 1);
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  // 从角色边缘生成弹丸（避免出生即碰撞自己）
  const x = shooter.x + Math.cos(angle) * (AGENT_RADIUS + PROJECTILE_RADIUS + 0.8);
  const y = shooter.y + Math.sin(angle) * (AGENT_RADIUS + PROJECTILE_RADIUS + 0.8);

  return {
    id,
    shooterId: shooter.id,
    targetId: null,
    previousX: x,
    previousY: y,
    x, y, angle, vx, vy, damage,
    bouncesLeft: PROJECTILE_BOUNCES,
    time: now,
  };
}

/**
 * 移动弹丸一个时间步长。
 * 基于速度和时间增量，保存上一帧位置用于绘制拖尾。
 */
export function moveProjectile(shot: ArenaShot, elapsedSeconds: number): ArenaShot {
  const x = shot.x + shot.vx * elapsedSeconds;
  const y = shot.y + shot.vy * elapsedSeconds;

  return {
    ...shot,
    previousX: shot.x,
    previousY: shot.y,
    x, y,
    angle: Math.atan2(shot.vy, shot.vx),
  };
}

/** 弹丸碰撞结果 */
export interface ProjectileCollisionResult {
  shot: ArenaShot;
  /** 是否发生反弹 */
  bounced: boolean;
  /** 是否已过期消失 */
  expired: boolean;
  /** 碰撞点 X */
  impactX: number;
  /** 碰撞点 Y */
  impactY: number;
}

/**
 * 解析弹丸碰撞。
 * 按优先级检查：战场边界 → 固体障碍物。
 * 碰撞时若还有反弹次数则反弹，否则消失。
 */
export function resolveProjectileCollision(shot: ArenaShot): ProjectileCollisionResult {
  // 先检查边界碰撞
  const boundaryCollision = getBoundaryCollision(shot);
  if (boundaryCollision) return boundaryCollision;

  // 再检查固体障碍物碰撞
  for (const zone of getSolidZones()) {
    const dx = shot.x - zone.x;
    const dy = shot.y - zone.y;
    const currentDistance = Math.hypot(dx, dy);
    const minimumDistance = zone.radius + PROJECTILE_RADIUS;
    if (currentDistance > minimumDistance) continue;

    const nx = currentDistance > 0 ? dx / currentDistance : 1;
    const ny = currentDistance > 0 ? dy / currentDistance : 0;
    return bounceOrExpire(shot, nx, ny, zone.x + nx * minimumDistance, zone.y + ny * minimumDistance);
  }

  // 无碰撞
  return { shot, bounced: false, expired: false, impactX: shot.x, impactY: shot.y };
}

/**
 * 判断弹丸是否超过生命周期。
 */
export function isProjectileExpired(shot: ArenaShot, now: number) {
  return now - shot.time > PROJECTILE_LIFETIME_MS;
}

/** 获取所有固体障碍物（中继站 + 掩体，核心区域可穿越） */
export function getSolidZones() {
  return ARENA_ZONES.filter((zone) => zone.kind !== "core");
}

/** 判断角色是否在核心占领区内 */
export function isInCore(agent: Pick<ArenaAgent, "x" | "y">) {
  return distance(agent, ARENA_ZONES[0]) <= CAPTURE_RADIUS;
}

// =============================================================================
// 道具系统
// =============================================================================

/**
 * 创建一个升级道具。
 * 从预设出生点按序列轮流生成，类型也按序列轮换。
 *
 * @param id       道具唯一标识
 * @param now      生成时刻
 * @param sequence 序列号（决定位置和类型）
 */
export function createUpgradeItem(id: string, now: number, sequence: number): ArenaUpgrade {
  const point = UPGRADE_SPAWN_POINTS[Math.abs(sequence) % UPGRADE_SPAWN_POINTS.length];
  const upgrade = UPGRADE_KINDS[Math.abs(sequence) % UPGRADE_KINDS.length];
  return {
    id,
    x: point.x,
    y: point.y,
    kind: upgrade.kind,
    label: upgrade.label,
    spawnedAt: now,
    expiresAt: now + UPGRADE_LIFETIME_MS,
  };
}

/**
 * 判断角色是否能拾取指定道具。
 * 角色碰撞圆与道具圆重叠即可拾取。
 */
export function isUpgradeCollectible(agent: Pick<ArenaAgent, "x" | "y">, upgrade: ArenaUpgrade) {
  return distance(agent, upgrade) <= AGENT_RADIUS + UPGRADE_RADIUS;
}

// =============================================================================
// 重生系统
// =============================================================================

/**
 * 重生角色。
 * 保留击杀数和 Overdrive 状态，重置位置到出生点、HP 满、能量 72。
 *
 * @param agent  被击杀前的角色
 * @param now    当前时刻
 * @param offset 出生点偏移
 */
export function respawnAgent(agent: ArenaAgent, now: number, offset = 0): ArenaAgent {
  const spawn = getSpawnPoint(offset);
  const profile = getCharacterProfile(agent.color);
  return {
    ...agent,
    x: spawn.x,
    y: spawn.y,
    hp: profile.stats.maxHp,
    energy: 72,
    isOverdrive: agent.isOverdrive,
    action: "idle",
    updatedAt: now,
  };
}

/**
 * 获取出生点坐标。
 * 4 个出生点分布在战场四角。
 */
export function getSpawnPoint(offset: number) {
  const spawns = [
    { x: 16, y: 18 },  // 左上
    { x: 84, y: 18 },  // 右上
    { x: 16, y: 82 },  // 左下
    { x: 84, y: 82 },  // 右下
  ];
  return spawns[Math.abs(offset) % spawns.length];
}

/** 将值夹持到 [min, max] 范围内 */
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// =============================================================================
// 内部数学工具
// =============================================================================

/** 计算两个角度之间的最短差值（[-π, π]） */
function shortestAngleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** 角度转弧度 */
function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

/** 检查弹丸与战场四壁的碰撞 */
function getBoundaryCollision(shot: ArenaShot): ProjectileCollisionResult | null {
  if (shot.x <= PROJECTILE_RADIUS)       return bounceOrExpire(shot, 1, 0, PROJECTILE_RADIUS, shot.y);
  if (shot.x >= ARENA_WIDTH - PROJECTILE_RADIUS)  return bounceOrExpire(shot, -1, 0, ARENA_WIDTH - PROJECTILE_RADIUS, shot.y);
  if (shot.y <= PROJECTILE_RADIUS)       return bounceOrExpire(shot, 0, 1, shot.x, PROJECTILE_RADIUS);
  if (shot.y >= ARENA_HEIGHT - PROJECTILE_RADIUS) return bounceOrExpire(shot, 0, -1, shot.x, ARENA_HEIGHT - PROJECTILE_RADIUS);
  return null;
}

/**
 * 处理弹丸反弹或消失。
 * 反弹：基于法向量反射速度方向，消耗一次反弹次数。
 * 消失：弹丸已无反弹次数，在碰撞点标记为过期。
 *
 * @param shot     弹丸
 * @param nx       碰撞法向量 X 分量
 * @param ny       碰撞法向量 Y 分量
 * @param impactX  碰撞点 X
 * @param impactY  碰撞点 Y
 */
function bounceOrExpire(shot: ArenaShot, nx: number, ny: number, impactX: number, impactY: number): ProjectileCollisionResult {
  // 无反弹次数 → 消失
  if (shot.bouncesLeft <= 0) {
    return {
      shot: { ...shot, x: impactX, y: impactY },
      bounced: false,
      expired: true,
      impactX,
      impactY,
    };
  }

  // 基于法向量计算反射方向：v' = v - 2(v·n)n
  const dot = shot.vx * nx + shot.vy * ny;
  const vx = shot.vx - 2 * dot * nx;
  const vy = shot.vy - 2 * dot * ny;

  return {
    shot: {
      ...shot,
      previousX: impactX,
      previousY: impactY,
      x: impactX,
      y: impactY,
      vx, vy,
      angle: Math.atan2(vy, vx),
      bouncesLeft: shot.bouncesLeft - 1,
    },
    bounced: true,
    expired: false,
    impactX,
    impactY,
  };
}
