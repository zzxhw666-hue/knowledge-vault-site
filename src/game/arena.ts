import type { PresencePlayer } from "./types";

export interface ArenaAgent extends PresencePlayer {
  x: number;
  y: number;
  angle: number;
  hp: number;
  energy: number;
  score: number;
  action: "idle" | "move" | "fire" | "dash" | "capture" | "down";
  updatedAt: number;
}

export interface ArenaShot {
  id: string;
  shooterId: string;
  targetId: string | null;
  x: number;
  y: number;
  angle: number;
  time: number;
}

export type ArenaSignal =
  | { type: "agent"; agent: ArenaAgent }
  | { type: "shot"; shot: ArenaShot }
  | { type: "score"; playerId: string; score: number; time: number };

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

export function createArenaAgent(player: PresencePlayer, now: number, offset = 0): ArenaAgent {
  const spawn = getSpawnPoint(offset);
  return {
    ...player,
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    hp: 100,
    energy: 100,
    score: 0,
    action: "idle",
    updatedAt: now,
  };
}

export function clampAgent(agent: ArenaAgent): ArenaAgent {
  return {
    ...agent,
    x: clamp(agent.x, AGENT_RADIUS, ARENA_WIDTH - AGENT_RADIUS),
    y: clamp(agent.y, AGENT_RADIUS, ARENA_HEIGHT - AGENT_RADIUS),
    hp: clamp(agent.hp, 0, 100),
    energy: clamp(agent.energy, 0, 100),
  };
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

export function isInCore(agent: Pick<ArenaAgent, "x" | "y">) {
  return distance(agent, ARENA_ZONES[0]) <= CAPTURE_RADIUS;
}

export function respawnAgent(agent: ArenaAgent, now: number, offset = 0): ArenaAgent {
  const spawn = getSpawnPoint(offset);
  return {
    ...agent,
    x: spawn.x,
    y: spawn.y,
    hp: 100,
    energy: 72,
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
