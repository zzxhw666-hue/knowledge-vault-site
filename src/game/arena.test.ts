import { describe, expect, it } from "vitest";
import {
  createArenaAgent,
  createProjectile,
  resolveAgentCollision,
  resolveProjectileCollision,
  AGENT_RADIUS,
} from "./arena";
import type { PresencePlayer } from "./types";

const player: PresencePlayer = {
  id: "p1",
  name: "Tester",
  color: "#50e6a4",
  codename: "渡鸦",
  joinedAt: 1,
};

describe("arena physics", () => {
  it("pushes agents out of solid relay zones", () => {
    const agent = createArenaAgent(player, 1);
    const resolved = resolveAgentCollision({
      ...agent,
      x: 50,
      y: 18,
    });

    expect(Math.hypot(resolved.x - 50, resolved.y - 18)).toBeGreaterThanOrEqual(6 + AGENT_RADIUS - 0.01);
  });

  it("bounces projectiles off solid zones once", () => {
    const agent = createArenaAgent(player, 1);
    const shot = createProjectile({ ...agent, x: 50, y: 10, angle: Math.PI / 2 }, "s1", 1);
    const result = resolveProjectileCollision({
      ...shot,
      previousX: 50,
      previousY: 10,
      x: 50,
      y: 11,
      vx: 0,
      vy: 76,
    });

    expect(result.bounced).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.shot.bouncesLeft).toBe(0);
    expect(result.shot.vy).toBeLessThan(0);
  });
});
