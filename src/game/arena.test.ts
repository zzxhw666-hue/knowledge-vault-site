/**
 * 「角色竞技场」物理引擎单元测试。
 *
 * 测试覆盖：
 * - 角色与固体障碍物的碰撞推出
 * - 弹丸碰撞掩体后反弹（消耗 bouncesLeft）
 * - 角色伤害属性影响弹丸伤害
 * - 道具拾取判定的距离阈值
 * - 核心回血基线值
 * - 角色初始状态（击杀/死亡/Overdrive）
 * - 道具种类循环生成
 * - 20 杀获胜条件
 *
 * 使用 Vitest 运行：npx vitest run src/game/arena.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  CORE_HEAL_PER_SECOND, KILL_LIMIT,
  createArenaAgent, createProjectile, createUpgradeItem,
  isUpgradeCollectible, resolveAgentCollision, resolveProjectileCollision,
  AGENT_RADIUS, UPGRADE_RADIUS,
} from "./arena";
import type { PresencePlayer } from "./types";

// 测试用的玩家对象
const player: PresencePlayer = {
  id: "p1", name: "Tester", color: "#50e6a4", codename: "渡鸦", joinedAt: 1,
};

describe("arena physics", () => {
  /** 角色进入固体中继站区域时被推出到最小安全距离 */
  it("pushes agents out of solid relay zones", () => {
    const agent = createArenaAgent(player, 1);
    const resolved = resolveAgentCollision({ ...agent, x: 50, y: 18 });

    // 距区域中心距离 ≥ 区域半径 + 角色半径
    expect(Math.hypot(resolved.x - 50, resolved.y - 18)).toBeGreaterThanOrEqual(6 + AGENT_RADIUS - 0.01);
  });

  /** 弹丸撞击固体区域时反弹一次，无剩余次数后消失 */
  it("bounces projectiles off solid zones once", () => {
    const agent = createArenaAgent(player, 1);
    const shot = createProjectile({ ...agent, x: 50, y: 10, angle: Math.PI / 2 }, "s1", 1);
    const result = resolveProjectileCollision({
      ...shot, previousX: 50, previousY: 10,
      x: 50, y: 11, vx: 0, vy: 76,
    });

    expect(result.bounced).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.shot.bouncesLeft).toBe(0);    // 消耗 1 次反弹
    expect(result.shot.vy).toBeLessThan(0);      // 向上反弹
  });

  /** 金焰破门手角色属性使弹丸伤害高于基准值 28 */
  it("applies character damage traits to projectiles", () => {
    const agent = createArenaAgent({ ...player, color: "#f1b84b" }, 1);
    const shot = createProjectile(agent, "s2", 1);

    expect(shot.damage).toBeGreaterThan(28);
  });

  /** 道具只有角色进入拾取半径内才可收集 */
  it("collects upgrade items only inside pickup radius", () => {
    const agent = createArenaAgent(player, 1);
    const upgrade = createUpgradeItem("u1", 1, 0);

    // 刚好在半径内 → 可拾取
    expect(isUpgradeCollectible(
      { ...agent, x: upgrade.x, y: upgrade.y + AGENT_RADIUS + UPGRADE_RADIUS - 0.1 },
      upgrade
    )).toBe(true);

    // 超出半径 → 不可拾取
    expect(isUpgradeCollectible(
      { ...agent, x: upgrade.x, y: upgrade.y + AGENT_RADIUS + UPGRADE_RADIUS + 1 },
      upgrade
    )).toBe(false);
  });

  /** 核心回血基线为 20 HP/秒 */
  it("uses 20 hp per second as the core healing baseline", () => {
    expect(CORE_HEAL_PER_SECOND).toBe(20);
  });

  /** 角色初始状态：0 击杀、0 死亡、Overdrive 关闭 */
  it("starts agents with kill and death counters", () => {
    const agent = createArenaAgent(player, 1);

    expect(agent.kills).toBe(0);
    expect(agent.deaths).toBe(0);
    expect(agent.isOverdrive).toBe(false);
  });

  /** 5 种道具类型按序列循环生成 */
  it("cycles through several upgrade pack types", () => {
    const kinds = new Set(
      Array.from({ length: 5 }, (_, index) => createUpgradeItem(`u${index}`, 1, index).kind)
    );

    expect(kinds).toEqual(new Set(["splitter", "medkit", "battery", "haste", "guard"]));
  });

  /** 击杀上限为 20 */
  it("ends arena matches at twenty kills", () => {
    expect(KILL_LIMIT).toBe(20);
  });
});
