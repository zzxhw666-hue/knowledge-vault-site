import { describe, expect, it } from "vitest";
import {
  CORE_HEAL_PER_SECOND,
  createArenaAgent,
  createProjectile,
  createUpgradeItem,
  isUpgradeCollectible,
  resolveAgentCollision,
  resolveProjectileCollision,
  AGENT_RADIUS,
  UPGRADE_RADIUS,
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

  it("applies character damage traits to projectiles", () => {
    const agent = createArenaAgent({ ...player, color: "#f1b84b" }, 1);
    const shot = createProjectile(agent, "s2", 1);

    expect(shot.damage).toBeGreaterThan(28);
  });

  it("collects upgrade items only inside pickup radius", () => {
    const agent = createArenaAgent(player, 1);
    const upgrade = createUpgradeItem("u1", 1, 0);

    expect(isUpgradeCollectible({ ...agent, x: upgrade.x, y: upgrade.y + AGENT_RADIUS + UPGRADE_RADIUS - 0.1 }, upgrade)).toBe(true);
    expect(isUpgradeCollectible({ ...agent, x: upgrade.x, y: upgrade.y + AGENT_RADIUS + UPGRADE_RADIUS + 1 }, upgrade)).toBe(false);
  });

  it("uses 20 hp per second as the core healing baseline", () => {
    expect(CORE_HEAL_PER_SECOND).toBe(20);
  });
});
