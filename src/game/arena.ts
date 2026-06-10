import type { PresencePlayer } from "./types";
import { getCharacterProfile } from "./config";

export interface ArenaAgent extends PresencePlayer {
  x: number;
  y: number;
  angle: number;
  hp: number;
  energy: number;
  score: number;
  kills: number;
  deaths: number;
  isOverdrive: boolean;
  action: "idle" | "move" | "fire" | "dash" | "capture" | "hit" | "heal" | "down";
  updatedAt: number;
}

export interface ArenaShot {
  id: string;
  shooterId: string;
  targetId: string | null;
  previousX: number;
  previousY: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  damage: number;
  bouncesLeft: number;
  time: number;
}

export interface ArenaUpgrade {
  id: string;
  x: number;
  y: number;
  kind: "splitter" | "medkit" | "battery" | "haste" | "guard";
  label: string;
  spawnedAt: number;
  expiresAt: number;
}

export type ArenaSignal =
  | { type: "agent"; agent: ArenaAgent }
  | { type: "shot"; shot: ArenaShot }
  | { type: "score"; playerId: string; score: number; time: number }
  | { type: "room-start"; startedBy: string; startedAt: number }
  | { type: "upgrade-spawn"; upgrade: ArenaUpgrade }
  | { type: "upgrade-collect"; upgradeId: string; playerId: string; time: number }
  | { type: "damage"; targetId: string; shooterId: string; shotId: string; damage: number; time: number }
  | { type: "elimination"; killerId: string; targetId: string; time: number }
  | { type: "game-over"; winnerId: string; time: number };

export interface ArenaZone {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  kind: "core" | "relay" | "cover";
}

export const ARENA_WIDTH = 100;
export const ARENA_HEIGHT = 100;
export const AGENT_RADIUS = 3.2;
export const MOVE_SPEED = 28;
export const DASH_DISTANCE = 12;
export const DASH_COST = 28;
export const FIRE_COST = 12;
export const FIRE_RANGE = 38;
export const FIRE_ARC_DEGREES = 12;
export const FIRE_DAMAGE = 28;
export const PROJECTILE_SPEED = 76;
export const PROJECTILE_RADIUS = 1.35;
export const PROJECTILE_BOUNCES = 1;
export const PROJECTILE_LIFETIME_MS = 2200;
export const CORE_HEAL_PER_SECOND = 20;
export const UPGRADE_SPAWN_INTERVAL_MS = 10_000;
export const UPGRADE_LIFETIME_MS = 18_000;
export const UPGRADE_RADIUS = 2.6;
export const MAX_WEAPON_UPGRADES = 4;
export const MIN_ARENA_PLAYERS_TO_START = 2;
export const KILL_LIMIT = 20;
export const OVERDRIVE_RADIUS_MULTIPLIER = 2.25;
export const ENERGY_REGEN_PER_SECOND = 18;
export const CAPTURE_RADIUS = 10;
export const CAPTURE_SECONDS = 4.2;

export const ARENA_ZONES: ArenaZone[] = [
  { id: "core", label: "中央信标", x: 50, y: 50, radius: CAPTURE_RADIUS, kind: "core" },
  { id: "north-relay", label: "北部中继", x: 50, y: 18, radius: 6, kind: "relay" },
  { id: "east-relay", label: "东部中继", x: 79, y: 50, radius: 6, kind: "relay" },
  { id: "south-relay", label: "南部中继", x: 50, y: 82, radius: 6, kind: "relay" },
  { id: "west-relay", label: "西部中继", x: 21, y: 50, radius: 6, kind: "relay" },
  { id: "cover-a", label: "掩体", x: 30, y: 30, radius: 5, kind: "cover" },
  { id: "cover-b", label: "掩体", x: 70, y: 70, radius: 5, kind: "cover" },
];

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

const UPGRADE_KINDS: Array<Pick<ArenaUpgrade, "kind" | "label">> = [
  { kind: "splitter", label: "+1 弹道" },
  { kind: "medkit", label: "急救包" },
  { kind: "battery", label: "能量包" },
  { kind: "haste", label: "疾行包" },
  { kind: "guard", label: "护盾包" },
];

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

export function resolveAgentCollision(agent: ArenaAgent): ArenaAgent {
  let next = clampAgent(agent);

  for (const zone of getSolidZones()) {
    const dx = next.x - zone.x;
    const dy = next.y - zone.y;
    const currentDistance = Math.hypot(dx, dy);
    const minimumDistance = zone.radius + AGENT_RADIUS;
    if (currentDistance >= minimumDistance) continue;

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

export function distance(a: Pick<ArenaAgent, "x" | "y">, b: Pick<ArenaAgent, "x" | "y">) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleTo(from: Pick<ArenaAgent, "x" | "y">, to: Pick<ArenaAgent, "x" | "y">) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

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

export function createProjectile(
  shooter: ArenaAgent,
  id: string,
  now: number,
  options: {
    angleOffset?: number;
    speedMultiplier?: number;
    damageMultiplier?: number;
  } = {}
): ArenaShot {
  const profile = getCharacterProfile(shooter.color);
  const angle = shooter.angle + (options.angleOffset ?? 0);
  const speed = PROJECTILE_SPEED * profile.stats.projectileSpeed * (options.speedMultiplier ?? 1);
  const damage = FIRE_DAMAGE * profile.stats.damage * (options.damageMultiplier ?? 1);
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const x = shooter.x + Math.cos(angle) * (AGENT_RADIUS + PROJECTILE_RADIUS + 0.8);
  const y = shooter.y + Math.sin(angle) * (AGENT_RADIUS + PROJECTILE_RADIUS + 0.8);

  return {
    id,
    shooterId: shooter.id,
    targetId: null,
    previousX: x,
    previousY: y,
    x,
    y,
    angle,
    vx,
    vy,
    damage,
    bouncesLeft: PROJECTILE_BOUNCES,
    time: now,
  };
}

export function moveProjectile(shot: ArenaShot, elapsedSeconds: number): ArenaShot {
  const x = shot.x + shot.vx * elapsedSeconds;
  const y = shot.y + shot.vy * elapsedSeconds;

  return {
    ...shot,
    previousX: shot.x,
    previousY: shot.y,
    x,
    y,
    angle: Math.atan2(shot.vy, shot.vx),
  };
}

export interface ProjectileCollisionResult {
  shot: ArenaShot;
  bounced: boolean;
  expired: boolean;
  impactX: number;
  impactY: number;
}

export function resolveProjectileCollision(shot: ArenaShot): ProjectileCollisionResult {
  const boundaryCollision = getBoundaryCollision(shot);
  if (boundaryCollision) {
    return boundaryCollision;
  }

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

  return {
    shot,
    bounced: false,
    expired: false,
    impactX: shot.x,
    impactY: shot.y,
  };
}

export function isProjectileExpired(shot: ArenaShot, now: number) {
  return now - shot.time > PROJECTILE_LIFETIME_MS;
}

export function getSolidZones() {
  return ARENA_ZONES.filter((zone) => zone.kind !== "core");
}

export function isInCore(agent: Pick<ArenaAgent, "x" | "y">) {
  return distance(agent, ARENA_ZONES[0]) <= CAPTURE_RADIUS;
}

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

export function isUpgradeCollectible(agent: Pick<ArenaAgent, "x" | "y">, upgrade: ArenaUpgrade) {
  return distance(agent, upgrade) <= AGENT_RADIUS + UPGRADE_RADIUS;
}

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

export function getSpawnPoint(offset: number) {
  const spawns = [
    { x: 16, y: 18 },
    { x: 84, y: 18 },
    { x: 16, y: 82 },
    { x: 84, y: 82 },
  ];
  return spawns[Math.abs(offset) % spawns.length];
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function shortestAngleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getBoundaryCollision(shot: ArenaShot): ProjectileCollisionResult | null {
  if (shot.x <= PROJECTILE_RADIUS) {
    return bounceOrExpire(shot, 1, 0, PROJECTILE_RADIUS, shot.y);
  }
  if (shot.x >= ARENA_WIDTH - PROJECTILE_RADIUS) {
    return bounceOrExpire(shot, -1, 0, ARENA_WIDTH - PROJECTILE_RADIUS, shot.y);
  }
  if (shot.y <= PROJECTILE_RADIUS) {
    return bounceOrExpire(shot, 0, 1, shot.x, PROJECTILE_RADIUS);
  }
  if (shot.y >= ARENA_HEIGHT - PROJECTILE_RADIUS) {
    return bounceOrExpire(shot, 0, -1, shot.x, ARENA_HEIGHT - PROJECTILE_RADIUS);
  }
  return null;
}

function bounceOrExpire(shot: ArenaShot, nx: number, ny: number, impactX: number, impactY: number): ProjectileCollisionResult {
  if (shot.bouncesLeft <= 0) {
    return {
      shot: {
        ...shot,
        x: impactX,
        y: impactY,
      },
      bounced: false,
      expired: true,
      impactX,
      impactY,
    };
  }

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
      vx,
      vy,
      angle: Math.atan2(vy, vx),
      bouncesLeft: shot.bouncesLeft - 1,
    },
    bounced: true,
    expired: false,
    impactX,
    impactY,
  };
}
