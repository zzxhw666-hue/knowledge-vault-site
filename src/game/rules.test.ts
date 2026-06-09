import { describe, expect, it } from "vitest";
import { BASE_RESOURCE_PER_SECOND, CORE_HOLD_TO_WIN_MS, EVENT_DURATION_MS, MATCH_DURATION_MS } from "./config";
import {
  canInvestInNode,
  createInitialGameState,
  gameReducer,
  getResourceRate,
  isCoreOpen,
} from "./rules";
import type { ActiveEvent, GameState, PresencePlayer } from "./types";

const now = 1_700_000_000_000;

const players: PresencePlayer[] = [
  {
    id: "p1",
    name: "Alice",
    color: "#50e6a4",
    codename: "渡鸦",
    joinedAt: now,
  },
  {
    id: "p2",
    name: "Bob",
    color: "#f1b84b",
    codename: "棱镜",
    joinedAt: now + 1,
  },
];

function runningState(): GameState {
  let state = createInitialGameState("ABCD", "test-seed");
  state = gameReducer(state, { type: "syncPlayers", players, hostId: "p1", now });
  state = gameReducer(state, { type: "startGame", now });
  return state;
}

function invest(state: GameState, playerId: string, nodeId: "relay-north" | "core", amount: number, at = now): GameState {
  return gameReducer(state, {
    type: "invest",
    now: at,
    intent: {
      playerId,
      nodeId,
      amount,
      intentId: `${playerId}:${nodeId}:${amount}:${at}`,
      sentAt: at,
    },
  });
}

describe("game rules", () => {
  it("captures a node by investment advantage", () => {
    let state = runningState();
    state = invest(state, "p1", "relay-north", 8);

    expect(state.nodes["relay-north"].ownerId).toBe("p1");
    expect(state.players.p1.resources).toBe(10);

    state = invest(state, "p2", "relay-north", 9);

    expect(state.nodes["relay-north"].ownerId).toBe("p2");
    expect(state.players.p2.resources).toBe(9);
  });

  it("locks the core until the timer opens it", () => {
    const state = runningState();

    expect(isCoreOpen(state, now + 1_000)).toBe(false);
    expect(canInvestInNode(state, "core", now + 1_000)).toBe(false);
    expect(isCoreOpen(state, now + 46_000)).toBe(true);
  });

  it("finishes when a player controls core long enough", () => {
    let state = runningState();
    const afterUnlock = now + 46_000;
    state = gameReducer(state, { type: "tick", now: afterUnlock });
    state = invest(state, "p1", "core", 10, afterUnlock);
    for (let elapsed = 5_000; elapsed <= CORE_HOLD_TO_WIN_MS + 5_000; elapsed += 5_000) {
      state = gameReducer(state, {
        type: "tick",
        now: afterUnlock + elapsed,
      });
    }

    expect(state.phase).toBe("finished");
    expect(state.winnerId).toBe("p1");
  });

  it("doubles resource rate during double supply", () => {
    const state = runningState();
    const event: ActiveEvent = {
      id: "event-1",
      type: "double_supply",
      title: "双倍补给",
      description: "产出翻倍。",
      startedAt: now,
      endsAt: now + EVENT_DURATION_MS,
    };

    expect(getResourceRate({ ...state, activeEvent: event }, "p1")).toBe(BASE_RESOURCE_PER_SECOND * 2);
  });

  it("blocks investment into a sealed node", () => {
    const state = {
      ...runningState(),
      activeEvent: {
        id: "event-2",
        type: "node_lock",
        title: "节点封锁",
        description: "暂停接收投入。",
        targetNodeId: "relay-north",
        startedAt: now,
        endsAt: now + EVENT_DURATION_MS,
      },
    } satisfies GameState;

    const next = invest(state, "p1", "relay-north", 5);

    expect(next.nodes["relay-north"].ownerId).toBeNull();
    expect(next.players.p1.resources).toBe(18);
  });

  it("settles by score when match time expires", () => {
    let state = runningState();
    state = invest(state, "p1", "relay-north", 6);
    state = gameReducer(state, { type: "tick", now: now + MATCH_DURATION_MS + 10 });

    expect(state.phase).toBe("finished");
    expect(state.winnerId).toBe("p1");
  });
});
