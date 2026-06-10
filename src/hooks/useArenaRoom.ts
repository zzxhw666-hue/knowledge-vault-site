import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ArenaAgent, ArenaSignal } from "../game/arena";
import type { PresencePlayer } from "../game/types";
import { createRealtimeClient } from "../lib/supabase";

type ConnectionStatus = "connecting" | "connected" | "missing-config" | "error";

interface BroadcastPayload {
  payload: ArenaSignal;
}

interface PresenceMeta {
  player?: PresencePlayer;
}

interface UseArenaRoomArgs {
  roomCode: string;
  localPlayer: PresencePlayer;
  onSignal: (signal: ArenaSignal) => void;
}

export function useArenaRoom({ roomCode, localPlayer, onSignal }: UseArenaRoomArgs) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [presencePlayers, setPresencePlayers] = useState<PresencePlayer[]>([localPlayer]);
  const [remoteAgents, setRemoteAgents] = useState<Record<string, ArenaAgent>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onSignalRef = useRef(onSignal);

  useEffect(() => {
    onSignalRef.current = onSignal;
  }, [onSignal]);

  const readPresence = useCallback((channel: RealtimeChannel) => {
    const presence = channel.presenceState<PresenceMeta>();
    const players = Object.values(presence)
      .flat()
      .map((meta) => meta.player)
      .filter((player): player is PresencePlayer => Boolean(player?.id))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));

    setPresencePlayers(players.length ? players : [localPlayer]);
  }, [localPlayer]);

  useEffect(() => {
    setConnectionStatus("connecting");
    setErrorMessage("");
    setPresencePlayers([localPlayer]);
    setRemoteAgents({});

    const client = createRealtimeClient();
    if (!client) {
      setConnectionStatus("missing-config");
      return;
    }

    const channel = client.channel(`arena:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence: { key: localPlayer.id },
      },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => readPresence(channel))
      .on("presence", { event: "join" }, () => readPresence(channel))
      .on("presence", { event: "leave" }, () => readPresence(channel))
      .on("broadcast", { event: "arena" }, (message: BroadcastPayload) => {
        const signal = message.payload;
        if (signal.type === "agent") {
          if (signal.agent.id !== localPlayer.id) {
            setRemoteAgents((agents) => ({
              ...agents,
              [signal.agent.id]: signal.agent,
            }));
          }
          return;
        }
        if (signal.type === "damage" && signal.targetId !== localPlayer.id) {
          setRemoteAgents((agents) => patchAgent(agents, signal.targetId, (agent) => ({
            ...agent,
            hp: Math.max(0, agent.hp - signal.damage),
            action: "hit",
            updatedAt: signal.time,
          })));
        }
        if (signal.type === "elimination") {
          setRemoteAgents((agents) => {
            let next = agents;
            if (signal.targetId !== localPlayer.id) {
              next = patchAgent(next, signal.targetId, (agent) => ({
                ...agent,
                hp: 0,
                deaths: agent.deaths + 1,
                action: "down",
                updatedAt: signal.time,
              }));
            }
            if (signal.killerId !== localPlayer.id) {
              next = patchAgent(next, signal.killerId, (agent) => ({
                ...agent,
                kills: agent.kills + 1,
                updatedAt: signal.time,
              }));
            }
            return next;
          });
        }
        onSignalRef.current(signal);
      })
      .subscribe(async (status, error) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
          await channel.track({ player: localPlayer });
          readPresence(channel);
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
  }, [localPlayer, readPresence, roomCode]);

  const sendSignal = useCallback((signal: ArenaSignal) => {
    void channelRef.current?.send({
      type: "broadcast",
      event: "arena",
      payload: signal,
    });
  }, []);

  const patchRemoteAgent = useCallback((agentId: string, updater: (agent: ArenaAgent) => ArenaAgent) => {
    setRemoteAgents((agents) => patchAgent(agents, agentId, updater));
  }, []);

  return {
    connectionStatus,
    errorMessage,
    presencePlayers,
    remoteAgents,
    sendSignal,
    patchRemoteAgent,
  };
}

function patchAgent(
  agents: Record<string, ArenaAgent>,
  agentId: string,
  updater: (agent: ArenaAgent) => ArenaAgent
): Record<string, ArenaAgent> {
  const agent = agents[agentId];
  if (!agent) return agents;
  return {
    ...agents,
    [agentId]: updater(agent),
  };
}
