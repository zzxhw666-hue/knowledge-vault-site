/**
 * 「情报暗战」策略推演模式 — 规则引擎单元测试。
 *
 * 测试覆盖：
 * - 据点通过投资优势占领（基本机制）
 * - 核心锁定/解锁时机
 * - 核心控制足够时间后获胜
 * - 双倍补给事件对资源产出的影响
 * - 节点封锁事件阻止投入
 * - 对局时间耗尽按积分结算
 *
 * 使用 Vitest 运行：npx vitest run src/game/rules.test.ts
 */
import { describe, expect, it } from "vitest";
import { BASE_RESOURCE_PER_SECOND, CORE_HOLD_TO_WIN_MS, EVENT_DURATION_MS, MATCH_DURATION_MS } from "./config";
import { canInvestInNode, createInitialGameState, gameReducer, getResourceRate, isCoreOpen } from "./rules";
import type { ActiveEvent, GameState, PresencePlayer } from "./types";

// 固定时间戳用于可重现测试
const now = 1_700_000_000_000;

// 两个测试玩家
const players: PresencePlayer[] = [
  { id: "p1", name: "Alice", color: "#50e6a4", codename: "渡鸦", joinedAt: now },
  { id: "p2", name: "Bob",   color: "#f1b84b", codename: "棱镜", joinedAt: now + 1 },
];

/**
 * 创建已开始对局的初始状态。
 * 先同步玩家 → 再开始对局。
 */
function runningState(): GameState {
  let state = createInitialGameState("ABCD", "test-seed");
  state = gameReducer(state, { type: "syncPlayers", players, hostId: "p1", now });
  state = gameReducer(state, { type: "startGame", now });
  return state;
}

/** 快捷投入指令 */
function invest(state: GameState, playerId: string, nodeId: "relay-north" | "core", amount: number, at = now): GameState {
  return gameReducer(state, {
    type: "invest",
    now: at,
    intent: { playerId, nodeId, amount, intentId: `${playerId}:${nodeId}:${amount}:${at}`, sentAt: at },
  });
}

describe("game rules", () => {
  /** 基本机制：投入更多情报点即可夺取据点控制权 */
  it("captures a node by investment advantage", () => {
    let state = runningState();

    state = invest(state, "p1", "relay-north", 8);
    expect(state.nodes["relay-north"].ownerId).toBe("p1");
    expect(state.players.p1.resources).toBe(10);  // 18 - 8

    state = invest(state, "p2", "relay-north", 9);
    expect(state.nodes["relay-north"].ownerId).toBe("p2");
    expect(state.players.p2.resources).toBe(9);   // 18 - 9
  });

  /** 核心在 CORE_LOCK_MS 毫秒内不可投入，到期后自动解锁 */
  it("locks the core until the timer opens it", () => {
    const state = runningState();

    expect(isCoreOpen(state, now + 1_000)).toBe(false);
    expect(canInvestInNode(state, "core", now + 1_000)).toBe(false);
    expect(isCoreOpen(state, now + 46_000)).toBe(true);
  });

  /** 控制核心达到 CORE_HOLD_TO_WIN_MS 毫秒后直接获胜 */
  it("finishes when a player controls core long enough", () => {
    let state = runningState();
    const afterUnlock = now + 46_000;

    // 等待核心解锁后投入并持续 tick
    state = gameReducer(state, { type: "tick", now: afterUnlock });
    state = invest(state, "p1", "core", 10, afterUnlock);

    for (let elapsed = 5_000; elapsed <= CORE_HOLD_TO_WIN_MS + 5_000; elapsed += 5_000) {
      state = gameReducer(state, { type: "tick", now: afterUnlock + elapsed });
    }

    expect(state.phase).toBe("finished");
    expect(state.winnerId).toBe("p1");
  });

  /** 双倍补给事件期间资源产出翻倍 */
  it("doubles resource rate during double supply", () => {
    const state = runningState();
    const event: ActiveEvent = {
      id: "event-1", type: "double_supply",
      title: "双倍补给", description: "产出翻倍。",
      startedAt: now, endsAt: now + EVENT_DURATION_MS,
    };

    expect(getResourceRate({ ...state, activeEvent: event }, "p1")).toBe(BASE_RESOURCE_PER_SECOND * 2);
  });

  /** 节点封锁事件期间，目标据点不接受投入 */
  it("blocks investment into a sealed node", () => {
    const state = {
      ...runningState(),
      activeEvent: {
        id: "event-2", type: "node_lock",
        title: "节点封锁", description: "暂停接收投入。",
        targetNodeId: "relay-north",
        startedAt: now, endsAt: now + EVENT_DURATION_MS,
      },
    } satisfies GameState;

    const next = invest(state, "p1", "relay-north", 5);

    expect(next.nodes["relay-north"].ownerId).toBeNull();
    expect(next.players.p1.resources).toBe(18);  // 资源未扣除
  });

  /** 对局时间耗尽后按积分结算 */
  it("settles by score when match time expires", () => {
    let state = runningState();

    state = invest(state, "p1", "relay-north", 6);
    state = gameReducer(state, { type: "tick", now: now + MATCH_DURATION_MS + 10 });

    expect(state.phase).toBe("finished");
    expect(state.winnerId).toBe("p1");
  });
});
