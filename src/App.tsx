import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Copy,
  Crosshair,
  LogIn,
  Play,
  RadioTower,
  RotateCcw,
  Shield,
  Signal,
  Swords,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import {
  CODENAMES,
  CORE_HOLD_TO_WIN_MS,
  MAP_LINKS,
  MATCH_DURATION_MS,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  NODE_ORDER,
  PLAYER_COLORS,
} from "./game/config";
import {
  canInvestInNode,
  eventMasksInvestments,
  getEffectiveInvestment,
  getPlayerNodeScore,
  getResourceRate,
  getWinnerCandidates,
  isCoreOpen,
} from "./game/rules";
import type { GameState, MapNode, NodeId, Player, PresencePlayer } from "./game/types";
import { useRealtimeRoom } from "./hooks/useRealtimeRoom";

interface RoomSession {
  roomCode: string;
  localPlayer: PresencePlayer;
}

const STORAGE_NAME_KEY = "intel-clash:name";
const STORAGE_COLOR_KEY = "intel-clash:color";
const STORAGE_CODENAME_KEY = "intel-clash:codename";

export function App() {
  const initialRoom = getRoomFromHash();
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoom);
  const [nameInput, setNameInput] = useState(() => localStorage.getItem(STORAGE_NAME_KEY) ?? "");
  const [colorIndex, setColorIndex] = useState(() => Number(localStorage.getItem(STORAGE_COLOR_KEY) ?? 0) || 0);
  const [codenameIndex, setCodenameIndex] = useState(() => Number(localStorage.getItem(STORAGE_CODENAME_KEY) ?? 0) || 0);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function beginRoom(code: string) {
    const trimmedName = nameInput.trim().slice(0, 16);
    const codename = CODENAMES[codenameIndex % CODENAMES.length];
    const playerName = trimmedName || codename;
    const roomCode = normalizeRoomCode(code || generateRoomCode());

    localStorage.setItem(STORAGE_NAME_KEY, playerName);
    localStorage.setItem(STORAGE_COLOR_KEY, String(colorIndex));
    localStorage.setItem(STORAGE_CODENAME_KEY, String(codenameIndex));
    window.location.hash = `room=${roomCode}`;
    setSession({
      roomCode,
      localPlayer: {
        id: createClientId(),
        name: playerName,
        color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
        codename,
        joinedAt: Date.now(),
      },
    });
  }

  if (session) {
    return (
      <GameRoom
        session={session}
        onLeave={() => {
          window.location.hash = "";
          setSession(null);
        }}
        showToast={setToast}
      />
    );
  }

  return (
    <main className="entry-shell">
      <section className="entry-stage">
        <div className="brand-lockup">
          <p>INTEL CLASH</p>
          <h1>情报暗战</h1>
        </div>

        <div className="entry-grid">
          <section className="entry-panel">
            <div className="panel-title">
              <RadioTower aria-hidden="true" />
              <div>
                <h2>开局</h2>
                <p>2-4 人混战，实时投入资源争夺中央信标核心。</p>
              </div>
            </div>

            <label>
              昵称
              <input
                value={nameInput}
                maxLength={16}
                placeholder="输入你的代号"
                onChange={(event) => setNameInput(event.target.value)}
              />
            </label>

            <div className="field-group">
              <span>阵营颜色</span>
              <div className="swatch-row">
                {PLAYER_COLORS.map((color, index) => (
                  <button
                    key={color}
                    type="button"
                    className={index === colorIndex ? "swatch selected" : "swatch"}
                    style={{ "--swatch": color } as CSSProperties}
                    aria-label={`选择颜色 ${index + 1}`}
                    onClick={() => setColorIndex(index)}
                  />
                ))}
              </div>
            </div>

            <label>
              行动代号
              <select value={codenameIndex} onChange={(event) => setCodenameIndex(Number(event.target.value))}>
                {CODENAMES.map((codename, index) => (
                  <option key={codename} value={index}>
                    {codename}
                  </option>
                ))}
              </select>
            </label>

            <div className="button-row">
              <button className="primary-button" type="button" onClick={() => beginRoom(generateRoomCode())}>
                <Play aria-hidden="true" />
                创建房间
              </button>
            </div>
          </section>

          <section className="entry-panel compact-panel">
            <div className="panel-title">
              <LogIn aria-hidden="true" />
              <div>
                <h2>加入</h2>
                <p>输入朋友给你的 4 位房间码。</p>
              </div>
            </div>

            <label>
              房间码
              <input
                value={roomCodeInput}
                maxLength={4}
                placeholder="例如 7KQ2"
                onChange={(event) => setRoomCodeInput(normalizeRoomCode(event.target.value))}
              />
            </label>

            <button
              className="secondary-button"
              type="button"
              disabled={normalizeRoomCode(roomCodeInput).length !== 4}
              onClick={() => beginRoom(roomCodeInput)}
            >
              <Users aria-hidden="true" />
              加入房间
            </button>
          </section>
        </div>
      </section>
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}

function GameRoom({
  session,
  onLeave,
  showToast,
}: {
  session: RoomSession;
  onLeave: () => void;
  showToast: (message: string) => void;
}) {
  const { gameState, presencePlayers, connectionStatus, errorMessage, isHost, sendInvest, requestStart, requestReset } =
    useRealtimeRoom({
      roomCode: session.roomCode,
      localPlayer: session.localPlayer,
    });
  const now = useClock(1000);
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId>("relay-north");
  const [investAmount, setInvestAmount] = useState(5);

  const currentPlayer = gameState.players[session.localPlayer.id];
  const selectedNode = gameState.nodes[selectedNodeId];
  const onlinePlayers = presencePlayers.slice(0, MAX_PLAYERS);
  const visiblePlayers = gameState.playerOrder.map((playerId) => gameState.players[playerId]).filter(Boolean);
  const maskedInvestments = eventMasksInvestments(gameState, session.localPlayer.id);
  const coreOpen = isCoreOpen(gameState, now);
  const coreOwner = gameState.nodes.core.ownerId ? gameState.players[gameState.nodes.core.ownerId] : null;
  const canStart =
    isHost &&
    gameState.phase !== "running" &&
    connectionStatus !== "missing-config" &&
    onlinePlayers.length >= MIN_PLAYERS_TO_START;
  const canInvest =
    gameState.phase === "running" &&
    Boolean(currentPlayer) &&
    canInvestInNode(gameState, selectedNodeId, now) &&
    Math.floor(currentPlayer?.resources ?? 0) > 0;
  const safeAmount = Math.min(Math.max(1, investAmount), Math.max(1, Math.floor(currentPlayer?.resources ?? 1)));
  const winners = getWinnerCandidates(gameState);

  useEffect(() => {
    if (!currentPlayer) return;
    setInvestAmount((amount) => Math.min(Math.max(1, amount), Math.max(1, Math.floor(currentPlayer.resources))));
  }, [currentPlayer?.resources]);

  function copyRoom() {
    const url = `${window.location.origin}${window.location.pathname}#room=${session.roomCode}`;
    void navigator.clipboard?.writeText(url);
    showToast("房间链接已复制。");
  }

  function invest(amount: number) {
    if (!canInvest || !currentPlayer) return;
    sendInvest({
      playerId: currentPlayer.id,
      nodeId: selectedNodeId,
      amount,
      intentId: createClientId(),
      sentAt: Date.now(),
    });
  }

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-inline">
          <RadioTower aria-hidden="true" />
          <div>
            <p>INTEL CLASH</p>
            <h1>情报暗战</h1>
          </div>
        </div>

        <div className="room-actions">
          <button className="icon-text-button" type="button" onClick={copyRoom}>
            <Copy aria-hidden="true" />
            {session.roomCode}
          </button>
          <span className={`status-pill ${connectionStatus}`}>{formatConnection(connectionStatus)}</span>
          <button className="ghost-button" type="button" onClick={onLeave}>
            离开
          </button>
        </div>
      </header>

      {errorMessage ? <div className="system-banner">{errorMessage}</div> : null}
      {connectionStatus === "missing-config" ? (
        <div className="system-banner">未找到 Supabase 配置，无法和朋友实时联机。</div>
      ) : null}

      <section className="command-grid">
        <section className="map-section">
          <div className="section-head">
            <div>
              <p>ROOM {session.roomCode}</p>
              <h2>行动地图</h2>
            </div>
            <RoundClock state={gameState} now={now} />
          </div>

          <IntelMap
            state={gameState}
            selectedNodeId={selectedNodeId}
            maskedInvestments={maskedInvestments}
            onSelect={setSelectedNodeId}
          />
        </section>

        <aside className="side-rail">
          <section className="panel">
            <div className="section-head compact">
              <div>
                <p>{isHost ? "房主裁判" : "作战成员"}</p>
                <h2>玩家</h2>
              </div>
              <Users aria-hidden="true" />
            </div>

            <div className="player-list">
              {(visiblePlayers.length ? visiblePlayers : onlinePlayers.map(toLobbyPlayer)).map((player) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  state={gameState}
                  isLocal={player.id === session.localPlayer.id}
                />
              ))}
            </div>

            {gameState.phase === "lobby" ? (
              <div className="lobby-actions">
                <p>{onlinePlayers.length}/{MAX_PLAYERS} 人已进入。</p>
                <button className="primary-button" type="button" disabled={!canStart} onClick={requestStart}>
                  <Play aria-hidden="true" />
                  开始行动
                </button>
              </div>
            ) : null}

            {gameState.phase === "finished" && isHost ? (
              <button className="secondary-button full-button" type="button" onClick={requestReset}>
                <RotateCcw aria-hidden="true" />
                重开一局
              </button>
            ) : null}
          </section>

          <section className="panel action-panel">
            <div className="section-head compact">
              <div>
                <p>{selectedNode.kind === "core" ? (coreOpen ? "核心开放" : "核心锁定") : selectedNode.kind}</p>
                <h2>{selectedNode.label}</h2>
              </div>
              {selectedNode.kind === "core" ? <Crosshair aria-hidden="true" /> : <Zap aria-hidden="true" />}
            </div>

            <p className="node-copy">{selectedNode.description}</p>
            <NodeInvestmentList state={gameState} node={selectedNode} masked={maskedInvestments} />

            <div className="invest-control">
              <label>
                投入情报点
                <input
                  type="range"
                  min={1}
                  max={Math.max(1, Math.floor(currentPlayer?.resources ?? 1))}
                  value={safeAmount}
                  disabled={!canInvest}
                  onChange={(event) => setInvestAmount(Number(event.target.value))}
                />
              </label>

              <div className="amount-row">
                {[3, 8, 15].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    disabled={!canInvest}
                    onClick={() => {
                      setInvestAmount(amount);
                      invest(amount);
                    }}
                  >
                    {amount}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={!canInvest}
                  onClick={() => {
                    const allIn = Math.floor(currentPlayer?.resources ?? 0);
                    setInvestAmount(allIn);
                    invest(allIn);
                  }}
                >
                  全压
                </button>
              </div>

              <button className="primary-button full-button" type="button" disabled={!canInvest} onClick={() => invest(safeAmount)}>
                <Zap aria-hidden="true" />
                投入 {canInvest ? safeAmount : 0}
              </button>
            </div>
          </section>

          <section className="panel event-panel">
            <div className="section-head compact">
              <div>
                <p>局势</p>
                <h2>事件</h2>
              </div>
              <Signal aria-hidden="true" />
            </div>

            {gameState.activeEvent ? (
              <div className="active-event">
                <strong>{gameState.activeEvent.title}</strong>
                <p>{gameState.activeEvent.description}</p>
                <span>{formatMs(Math.max(0, gameState.activeEvent.endsAt - now))}</span>
              </div>
            ) : (
              <div className="quiet-event">暂无事件</div>
            )}

            <div className="event-log">
              {gameState.eventLog.map((entry) => (
                <div key={entry.id} className="log-entry">
                  <span>{formatClock(entry.time)}</span>
                  <strong>{entry.title}</strong>
                  <p>{entry.body}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <CoreBar owner={coreOwner} state={gameState} now={now} />

      {gameState.phase === "finished" ? (
        <div className="endgame-backdrop">
          <section className="endgame-panel">
            <Trophy aria-hidden="true" />
            <p>行动结束</p>
            <h2>{gameState.winnerId ? `${gameState.players[gameState.winnerId]?.name} 控制了核心` : "无人完全掌控核心"}</h2>
            <span>{gameState.finishReason}</span>
            <div className="winner-list">
              {winners.map((winner, index) => {
                const player = gameState.players[winner.playerId];
                return (
                  <div key={winner.playerId}>
                    <b>{index + 1}</b>
                    <i style={{ "--player-color": player.color } as CSSProperties} />
                    <span>{player.name}</span>
                    <strong>{winner.score}</strong>
                  </div>
                );
              })}
            </div>
            {isHost ? (
              <button className="primary-button" type="button" onClick={requestReset}>
                <RotateCcw aria-hidden="true" />
                重开一局
              </button>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function IntelMap({
  state,
  selectedNodeId,
  maskedInvestments,
  onSelect,
}: {
  state: GameState;
  selectedNodeId: NodeId;
  maskedInvestments: boolean;
  onSelect: (nodeId: NodeId) => void;
}) {
  return (
    <div className="intel-map">
      <svg className="map-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {MAP_LINKS.map(([from, to]) => {
          const a = state.nodes[from];
          const b = state.nodes[to];
          return <line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      </svg>

      {NODE_ORDER.map((nodeId) => {
        const node = state.nodes[nodeId];
        const owner = node.ownerId ? state.players[node.ownerId] : null;
        const total = Object.values(node.investments).reduce((sum, value) => sum + value, 0);
        return (
          <button
            key={node.id}
            type="button"
            className={`map-node ${node.kind} ${selectedNodeId === node.id ? "selected" : ""} ${
              owner ? "owned" : ""
            }`}
            style={
              {
                "--x": `${node.x}%`,
                "--y": `${node.y}%`,
                "--owner-color": owner?.color ?? "#f4efdf",
              } as CSSProperties
            }
            onClick={() => onSelect(node.id)}
          >
            <span>{node.shortLabel}</span>
            <b>{owner?.codename ?? "空白"}</b>
            <i>{maskedInvestments && total > 0 ? "遮蔽" : Math.round(total)}</i>
          </button>
        );
      })}
    </div>
  );
}

function PlayerRow({ player, state, isLocal }: { player: Player; state: GameState; isLocal: boolean }) {
  const nodeScore = getPlayerNodeScore(state, player.id);
  const corePercent = Math.min(100, (player.coreHoldMs / CORE_HOLD_TO_WIN_MS) * 100);
  return (
    <div className={`player-row ${isLocal ? "local" : ""}`}>
      <i style={{ "--player-color": player.color } as CSSProperties} />
      <div>
        <strong>{player.name}</strong>
        <span>
          {player.codename} · {player.online ? "在线" : "离线"}
        </span>
        <div className="mini-meter">
          <b style={{ width: `${corePercent}%` }} />
        </div>
      </div>
      <aside>
        <b>{Math.floor(player.resources)}</b>
        <span>{nodeScore} 分</span>
      </aside>
    </div>
  );
}

function NodeInvestmentList({ state, node, masked }: { state: GameState; node: MapNode; masked: boolean }) {
  const entries = Object.entries(node.investments)
    .filter(([playerId]) => state.players[playerId])
    .map(([playerId, amount]) => ({
      player: state.players[playerId],
      amount,
      effective: getEffectiveInvestment(state, node, playerId),
    }))
    .sort((a, b) => b.effective - a.effective);

  if (!entries.length) {
    return <div className="empty-strip">无人投入</div>;
  }

  if (masked) {
    return <div className="empty-strip">通信遮蔽中</div>;
  }

  return (
    <div className="investment-list">
      {entries.map(({ player, amount, effective }) => (
        <div key={player.id}>
          <i style={{ "--player-color": player.color } as CSSProperties} />
          <span>{player.codename}</span>
          <b>{Math.round(amount)}</b>
          <small>{Math.round(effective)} 权重</small>
        </div>
      ))}
    </div>
  );
}

function RoundClock({ state, now }: { state: GameState; now: number }) {
  if (state.phase === "lobby") {
    return (
      <div className="clock-pill">
        <Shield aria-hidden="true" />
        待命
      </div>
    );
  }

  if (state.phase === "finished") {
    return (
      <div className="clock-pill done">
        <Trophy aria-hidden="true" />
        结束
      </div>
    );
  }

  const matchRemaining = state.startedAt ? Math.max(0, MATCH_DURATION_MS - (now - state.startedAt)) : 0;
  const coreRemaining = state.coreUnlockedAt ? Math.max(0, state.coreUnlockedAt - now) : 0;
  return (
    <div className="clock-stack">
      <span>{formatMs(matchRemaining)}</span>
      <b>{coreRemaining > 0 ? `核心锁定 ${formatMs(coreRemaining)}` : "核心开放"}</b>
    </div>
  );
}

function CoreBar({ owner, state, now }: { owner: Player | null; state: GameState; now: number }) {
  const percent = owner ? Math.min(100, (owner.coreHoldMs / CORE_HOLD_TO_WIN_MS) * 100) : 0;
  const coreOpen = isCoreOpen(state, now);
  return (
    <section className="core-bar">
      <div>
        <Swords aria-hidden="true" />
        <span>{coreOpen ? (owner ? `${owner.codename} 正在控制核心` : "核心开放，无人控制") : "核心仍在锁定"}</span>
      </div>
      <div className="core-meter">
        <b style={{ width: `${percent}%`, background: owner?.color ?? "#f4efdf" }} />
      </div>
      <strong>{owner ? `${Math.floor(owner.coreHoldMs / 1000)} / ${Math.floor(CORE_HOLD_TO_WIN_MS / 1000)}s` : "--"}</strong>
    </section>
  );
}

function toLobbyPlayer(player: PresencePlayer): Player {
  return {
    ...player,
    resources: 0,
    coreHoldMs: 0,
    online: true,
  };
}

function useClock(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function normalizeRoomCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}

function getRoomFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  return normalizeRoomCode(params.get("room") ?? "");
}

function createClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatConnection(status: string) {
  if (status === "connected") return "已连接";
  if (status === "connecting") return "连接中";
  if (status === "missing-config") return "未配置";
  if (status === "error") return "异常";
  return "待连接";
}

function formatMs(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(time: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(time));
}
