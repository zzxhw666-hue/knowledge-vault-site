import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createRealtimeClient } from "../lib/supabase";
import { createInitialGameState, gameReducer } from "../game/rules";
import type { GameAction, GameState, InvestIntent, PresencePlayer } from "../game/types";

type ConnectionStatus = "idle" | "connecting" | "connected" | "missing-config" | "error";

interface UseRealtimeRoomArgs {
  roomCode: string;
  localPlayer: PresencePlayer;
}

interface BroadcastPayload<T> {
  payload: T;
}

interface SnapshotMessage {
  state: GameState;
}

interface IntentMessage {
  intent: InvestIntent;
}

interface ControlMessage {
  action: "start" | "reset";
  requestedBy: string;
  now: number;
}

interface PresenceMeta {
  player?: PresencePlayer;
}

export function useRealtimeRoom({ roomCode, localPlayer }: UseRealtimeRoomArgs) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [gameState, setGameState] = useState<GameState>(() => createInitialGameState(roomCode));
  const [presencePlayers, setPresencePlayers] = useState<PresencePlayer[]>([]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const gameStateRef = useRef(gameState);
  const localPlayerRef = useRef(localPlayer);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    localPlayerRef.current = localPlayer;
  }, [localPlayer]);

  const isHost = gameState.hostId === localPlayer.id;

  const broadcastSnapshot = useCallback((state: GameState) => {
    void channelRef.current?.send({
      type: "broadcast",
      event: "snapshot",
      payload: { state } satisfies SnapshotMessage,
    });
  }, []);

  const applyHostAction = useCallback(
    (action: GameAction) => {
      setGameState((previous) => {
        const next = gameReducer(previous, action);
        gameStateRef.current = next;
        broadcastSnapshot(next);
        return next;
      });
    },
    [broadcastSnapshot]
  );

  const readPresencePlayers = useCallback((channel: RealtimeChannel): PresencePlayer[] => {
    const state = channel.presenceState<PresenceMeta>();
    return Object.values(state)
      .flat()
      .map((meta) => meta.player)
      .filter((player): player is PresencePlayer => Boolean(player?.id))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  }, []);

  const syncPresence = useCallback(
    (channel: RealtimeChannel) => {
      const players = readPresencePlayers(channel);
      const hostId = players[0]?.id ?? null;
      setPresencePlayers(players);

      setGameState((previous) => {
        const next = gameReducer(previous, {
          type: "syncPlayers",
          players,
          hostId,
          now: Date.now(),
        });
        gameStateRef.current = next;
        if (hostId === localPlayerRef.current.id) {
          broadcastSnapshot(next);
        }
        return next;
      });
    },
    [broadcastSnapshot, readPresencePlayers]
  );

  useEffect(() => {
    setGameState(createInitialGameState(roomCode));
    setPresencePlayers([]);
    setErrorMessage("");

    const client = createRealtimeClient();
    if (!client) {
      const fallbackState = gameReducer(createInitialGameState(roomCode), {
        type: "syncPlayers",
        players: [localPlayer],
        hostId: localPlayer.id,
        now: Date.now(),
      });
      setGameState(fallbackState);
      setPresencePlayers([localPlayer]);
      setConnectionStatus("missing-config");
      return;
    }

    setConnectionStatus("connecting");
    const channel = client.channel(`game:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence: { key: localPlayer.id },
      },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => syncPresence(channel))
      .on("presence", { event: "join" }, () => syncPresence(channel))
      .on("presence", { event: "leave" }, () => syncPresence(channel))
      .on("broadcast", { event: "intent" }, (message: BroadcastPayload<IntentMessage>) => {
        if (gameStateRef.current.hostId !== localPlayerRef.current.id) return;
        applyHostAction({
          type: "invest",
          intent: message.payload.intent,
          now: Date.now(),
        });
      })
      .on("broadcast", { event: "control" }, (message: BroadcastPayload<ControlMessage>) => {
        if (gameStateRef.current.hostId !== localPlayerRef.current.id) return;
        if (message.payload.action === "start") {
          applyHostAction({ type: "startGame", now: message.payload.now });
        }
        if (message.payload.action === "reset") {
          applyHostAction({ type: "resetToLobby", now: message.payload.now });
        }
      })
      .on("broadcast", { event: "snapshot" }, (message: BroadcastPayload<SnapshotMessage>) => {
        setGameState((previous) => {
          const incoming = message.payload.state;
          if (!shouldAcceptSnapshot(previous, incoming)) return previous;
          gameStateRef.current = incoming;
          return incoming;
        });
      })
      .subscribe(async (status, error) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
          await channel.track({ player: localPlayerRef.current });
          syncPresence(channel);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionStatus("error");
          setErrorMessage(error?.message ?? "房间连接失败。");
        }
      });

    return () => {
      channelRef.current = null;
      void channel.untrack();
      void client.removeChannel(channel);
    };
  }, [applyHostAction, localPlayer, roomCode, syncPresence]);

  useEffect(() => {
    if (!isHost || gameState.phase !== "running") return;
    const timer = window.setInterval(() => {
      applyHostAction({ type: "tick", now: Date.now() });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [applyHostAction, gameState.phase, isHost]);

  const sendInvest = useCallback(
    (intent: InvestIntent) => {
      if (gameStateRef.current.hostId === localPlayerRef.current.id || connectionStatus === "missing-config") {
        applyHostAction({ type: "invest", intent, now: Date.now() });
        return;
      }

      void channelRef.current?.send({
        type: "broadcast",
        event: "intent",
        payload: { intent } satisfies IntentMessage,
      });
    },
    [applyHostAction, connectionStatus]
  );

  const requestStart = useCallback(() => {
    const payload = {
      action: "start",
      requestedBy: localPlayerRef.current.id,
      now: Date.now(),
    } satisfies ControlMessage;

    if (gameStateRef.current.hostId === localPlayerRef.current.id || connectionStatus === "missing-config") {
      applyHostAction({ type: "startGame", now: payload.now });
      return;
    }

    void channelRef.current?.send({
      type: "broadcast",
      event: "control",
      payload,
    });
  }, [applyHostAction, connectionStatus]);

  const requestReset = useCallback(() => {
    const payload = {
      action: "reset",
      requestedBy: localPlayerRef.current.id,
      now: Date.now(),
    } satisfies ControlMessage;

    if (gameStateRef.current.hostId === localPlayerRef.current.id || connectionStatus === "missing-config") {
      applyHostAction({ type: "resetToLobby", now: payload.now });
      return;
    }

    void channelRef.current?.send({
      type: "broadcast",
      event: "control",
      payload,
    });
  }, [applyHostAction, connectionStatus]);

  const room = useMemo(
    () => ({
      gameState,
      presencePlayers,
      connectionStatus,
      errorMessage,
      isHost,
      sendInvest,
      requestStart,
      requestReset,
    }),
    [connectionStatus, errorMessage, gameState, isHost, presencePlayers, requestReset, requestStart, sendInvest]
  );

  return room;
}

function shouldAcceptSnapshot(previous: GameState, incoming: GameState): boolean {
  if (previous.roomCode !== incoming.roomCode) return false;
  if (incoming.snapshotVersion > previous.snapshotVersion) return true;
  const incomingTick = incoming.lastTickAt ?? 0;
  const previousTick = previous.lastTickAt ?? 0;
  return incoming.hostId !== previous.hostId && incomingTick >= previousTick;
}
