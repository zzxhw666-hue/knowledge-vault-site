import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  Copy,
  Crosshair,
  Gauge,
  Keyboard,
  LogIn,
  MousePointer2,
  Play,
  RadioTower,
  RotateCcw,
  Shield,
  Target,
  Users,
  Zap,
} from "lucide-react";
import {
  AGENT_RADIUS,
  ARENA_ZONES,
  CAPTURE_SECONDS,
  DASH_COST,
  DASH_DISTANCE,
  ENERGY_REGEN_PER_SECOND,
  FIRE_COST,
  FIRE_DAMAGE,
  clampAgent,
  createArenaAgent,
  findShotTarget,
  isInCore,
  respawnAgent,
} from "./game/arena";
import type { ArenaAgent, ArenaSignal, ArenaShot } from "./game/arena";
import { CODENAMES, PLAYER_COLORS } from "./game/config";
import type { PresencePlayer } from "./game/types";
import { useArenaRoom } from "./hooks/useArenaRoom";

interface RoomSession {
  roomCode: string;
  localPlayer: PresencePlayer;
}

interface LogEntry {
  id: string;
  time: number;
  text: string;
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
      <CharacterRoom
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
          <p>CHARACTER TEST ARENA</p>
          <h1>情报暗战</h1>
        </div>

        <div className="entry-grid">
          <section className="entry-panel">
            <div className="panel-title">
              <RadioTower aria-hidden="true" />
              <div>
                <h2>创建测试场</h2>
                <p>用键盘移动角色，用鼠标瞄准和行动，朋友可用房间码加入。</p>
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
              <span>角色颜色</span>
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

            <button className="primary-button" type="button" onClick={() => beginRoom(generateRoomCode())}>
              <Play aria-hidden="true" />
              创建房间
            </button>
          </section>

          <section className="entry-panel compact-panel">
            <div className="panel-title">
              <LogIn aria-hidden="true" />
              <div>
                <h2>加入朋友</h2>
                <p>输入 4 位房间码，进入同一个行动场。</p>
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

function CharacterRoom({
  session,
  onLeave,
  showToast,
}: {
  session: RoomSession;
  onLeave: () => void;
  showToast: (message: string) => void;
}) {
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const keysRef = useRef(new Set<string>());
  const pointerRef = useRef({ x: 50, y: 50 });
  const lastBroadcastRef = useRef(0);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const [shots, setShots] = useState<ArenaShot[]>([]);
  const [agent, setAgent] = useState(() => createArenaAgent(session.localPlayer, Date.now()));
  const [bot, setBot] = useState(() =>
    createArenaAgent(
      {
        id: "training-target",
        name: "训练靶机",
        color: "#f26d5b",
        codename: "靶机",
        joinedAt: Date.now(),
      },
      Date.now(),
      1
    )
  );

  const agentRef = useRef(agent);
  const botRef = useRef(bot);
  const remoteAgentsRef = useRef<Record<string, ArenaAgent>>({});

  const addLog = useCallback((text: string) => {
    setLogs((entries) => [{ id: createClientId(), time: Date.now(), text }, ...entries].slice(0, 8));
  }, []);

  const handleSignal = useCallback(
    (signal: ArenaSignal) => {
      if (signal.type === "shot") {
        setShots((items) => [...items.slice(-6), signal.shot]);
        if (signal.shot.targetId === session.localPlayer.id) {
          setAgent((previous) => {
            const hp = Math.max(0, previous.hp - FIRE_DAMAGE);
            if (hp <= 0) {
              addLog("你被命中，已重新部署。");
              return respawnAgent({ ...previous, hp }, Date.now(), 0);
            }
            addLog("你被脉冲命中。");
            return { ...previous, hp, action: "fire", updatedAt: Date.now() };
          });
        }
        return;
      }
      if (signal.type === "score" && signal.playerId !== session.localPlayer.id) {
        addLog("对手完成了一次核心上传。");
      }
    },
    [addLog, session.localPlayer.id]
  );

  const { connectionStatus, errorMessage, presencePlayers, remoteAgents, sendSignal } = useArenaRoom({
    roomCode: session.roomCode,
    localPlayer: session.localPlayer,
    onSignal: handleSignal,
  });

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    botRef.current = bot;
  }, [bot]);

  useEffect(() => {
    remoteAgentsRef.current = remoteAgents;
  }, [remoteAgents]);

  useEffect(() => {
    arenaRef.current?.focus();
    addLog("测试场已加载。WASD 移动，鼠标瞄准。");
  }, [addLog]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = normalizeKey(event.key);
      if (!key) return;
      event.preventDefault();
      if (key === "space" && !event.repeat) fire();
      if (key === "shift" && !event.repeat) dash();
      keysRef.current.add(key);
      setPressedKeys([...keysRef.current]);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = normalizeKey(event.key);
      if (!key) return;
      event.preventDefault();
      keysRef.current.delete(key);
      setPressedKeys([...keysRef.current]);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let lastTime = performance.now();

    const step = (time: number) => {
      const elapsed = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;
      const keys = keysRef.current;

      setAgent((previous) => {
        let dx = 0;
        let dy = 0;
        if (keys.has("w") || keys.has("arrowup")) dy -= 1;
        if (keys.has("s") || keys.has("arrowdown")) dy += 1;
        if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
        if (keys.has("d") || keys.has("arrowright")) dx += 1;

        const length = Math.hypot(dx, dy) || 1;
        const pointer = pointerRef.current;
        const angle = Math.atan2(pointer.y - previous.y, pointer.x - previous.x);
        const isMoving = dx !== 0 || dy !== 0;
        const isCapturing = keys.has("e") && isInCore(previous);
        let score = previous.score;

        if (isCapturing) {
          setCaptureProgress((progress) => {
            const next = Math.min(100, progress + (elapsed / CAPTURE_SECONDS) * 100);
            if (next >= 100 && progress < 100) {
              score += 1;
              addLog("核心上传完成，得分 +1。");
              sendSignal({ type: "score", playerId: previous.id, score, time: Date.now() });
              return 0;
            }
            return next;
          });
        } else {
          setCaptureProgress((progress) => Math.max(0, progress - elapsed * 18));
        }

        const next = clampAgent({
          ...previous,
          x: previous.x + (dx / length) * 28 * elapsed,
          y: previous.y + (dy / length) * 28 * elapsed,
          angle,
          energy: Math.min(100, previous.energy + ENERGY_REGEN_PER_SECOND * elapsed),
          score,
          action: isCapturing ? "capture" : isMoving ? "move" : "idle",
          updatedAt: Date.now(),
        });

        if (time - lastBroadcastRef.current > 80) {
          lastBroadcastRef.current = time;
          sendSignal({ type: "agent", agent: next });
        }

        return next;
      });

      setShots((items) => items.filter((shot) => Date.now() - shot.time < 180));
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [addLog, sendSignal]);

  const onlineAgents = useMemo(() => {
    const remote = Object.values(remoteAgents).filter((remoteAgent) => Date.now() - remoteAgent.updatedAt < 5000);
    const target = bot.hp > 0 ? [bot] : [];
    return [agent, ...remote, ...target];
  }, [agent, bot, remoteAgents]);

  function copyRoom() {
    const url = `${window.location.origin}${window.location.pathname}#room=${session.roomCode}`;
    void navigator.clipboard?.writeText(url);
    showToast("房间链接已复制。");
  }

  function updatePointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  }

  function fire() {
    const shooter = agentRef.current;
    if (shooter.energy < FIRE_COST || shooter.hp <= 0) return;
    const remotes = Object.values(remoteAgentsRef.current);
    const targets = [botRef.current, ...remotes].filter((target) => target.hp > 0);
    const target = findShotTarget(shooter, targets);
    const shot: ArenaShot = {
      id: createClientId(),
      shooterId: shooter.id,
      targetId: target?.id ?? null,
      x: shooter.x,
      y: shooter.y,
      angle: shooter.angle,
      time: Date.now(),
    };

    setAgent((previous) => ({
      ...previous,
      energy: Math.max(0, previous.energy - FIRE_COST),
      action: "fire",
      updatedAt: Date.now(),
    }));
    setShots((items) => [...items.slice(-6), shot]);
    sendSignal({ type: "shot", shot });

    if (target?.id === botRef.current.id) {
      setBot((previous) => {
        const hp = Math.max(0, previous.hp - FIRE_DAMAGE);
        if (hp <= 0) {
          addLog("训练靶机被击倒，正在重置。");
          window.setTimeout(() => setBot(respawnAgent(previous, Date.now(), 1)), 900);
        }
        return { ...previous, hp, action: "down", updatedAt: Date.now() };
      });
      return;
    }

    addLog(target ? "脉冲命中目标。" : "脉冲发射。");
  }

  function dash() {
    const current = agentRef.current;
    if (current.energy < DASH_COST || current.hp <= 0) return;
    setAgent((previous) =>
      clampAgent({
        ...previous,
        x: previous.x + Math.cos(previous.angle) * DASH_DISTANCE,
        y: previous.y + Math.sin(previous.angle) * DASH_DISTANCE,
        energy: previous.energy - DASH_COST,
        action: "dash",
        updatedAt: Date.now(),
      })
    );
    addLog("短距冲刺。");
  }

  function resetLocalTest() {
    const now = Date.now();
    setAgent(createArenaAgent(session.localPlayer, now));
    setBot(createArenaAgent(bot, now, 1));
    setCaptureProgress(0);
    setShots([]);
    addLog("本地测试状态已重置。");
  }

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-inline">
          <RadioTower aria-hidden="true" />
          <div>
            <p>REALTIME CHARACTER ARENA</p>
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
        <div className="system-banner">未找到 Supabase 配置，当前只能本地单人测试。</div>
      ) : null}

      <section className="arena-layout">
        <section className="arena-card">
          <div className="section-head">
            <div>
              <p>WASD / MOUSE</p>
              <h2>行动场</h2>
            </div>
            <button className="secondary-button" type="button" onClick={resetLocalTest}>
              <RotateCcw aria-hidden="true" />
              重置测试
            </button>
          </div>

          <div
            ref={arenaRef}
            className="character-arena"
            tabIndex={0}
            onPointerMove={updatePointer}
            onPointerDown={(event) => {
              updatePointer(event);
              if (event.button === 0) fire();
              if (event.button === 2) dash();
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {ARENA_ZONES.map((zone) => (
              <div
                key={zone.id}
                className={`arena-zone ${zone.kind}`}
                style={
                  {
                    "--x": `${zone.x}%`,
                    "--y": `${zone.y}%`,
                    "--r": `${zone.radius * 2}%`,
                  } as CSSProperties
                }
              >
                <span>{zone.label}</span>
              </div>
            ))}

            {shots.map((shot) => (
              <div
                key={shot.id}
                className="shot-beam"
                style={
                  {
                    "--x": `${shot.x}%`,
                    "--y": `${shot.y}%`,
                    "--angle": `${shot.angle}rad`,
                  } as CSSProperties
                }
              />
            ))}

            {onlineAgents.map((arenaAgent) => (
              <AgentSprite key={arenaAgent.id} agent={arenaAgent} isLocal={arenaAgent.id === agent.id} />
            ))}
          </div>
        </section>

        <aside className="test-rail">
          <section className="panel">
            <div className="section-head compact">
              <div>
                <p>LIVE TEST</p>
                <h2>实时测试</h2>
              </div>
              <Activity aria-hidden="true" />
            </div>

            <div className="meter-list">
              <Meter label="生命" value={agent.hp} tone="red" />
              <Meter label="能量" value={agent.energy} tone="green" />
              <Meter label="核心上传" value={captureProgress} tone="amber" />
            </div>

            <div className="diagnostic-grid">
              <Diagnostic icon={<Gauge aria-hidden="true" />} label="坐标" value={`${agent.x.toFixed(1)}, ${agent.y.toFixed(1)}`} />
              <Diagnostic icon={<Crosshair aria-hidden="true" />} label="朝向" value={`${Math.round((agent.angle * 180) / Math.PI)}°`} />
              <Diagnostic icon={<Target aria-hidden="true" />} label="得分" value={String(agent.score)} />
              <Diagnostic icon={<Users aria-hidden="true" />} label="在线" value={String(presencePlayers.length)} />
            </div>
          </section>

          <section className="panel">
            <div className="section-head compact">
              <div>
                <p>CONTROLS</p>
                <h2>操控</h2>
              </div>
              <Keyboard aria-hidden="true" />
            </div>

            <div className="control-list">
              <span>WASD / 方向键</span>
              <b>移动</b>
              <span>鼠标移动</span>
              <b>瞄准</b>
              <span>左键 / 空格</span>
              <b>脉冲射击</b>
              <span>Shift / 右键</span>
              <b>冲刺</b>
              <span>E + 核心范围</span>
              <b>上传核心</b>
            </div>

            <div className="pressed-keys">
              {pressedKeys.length ? pressedKeys.map((key) => <kbd key={key}>{key.toUpperCase()}</kbd>) : <span>等待输入</span>}
            </div>
          </section>

          <section className="panel">
            <div className="section-head compact">
              <div>
                <p>ROOM</p>
                <h2>玩家</h2>
              </div>
              <MousePointer2 aria-hidden="true" />
            </div>

            <div className="arena-player-list">
              {presencePlayers.map((player) => (
                <div key={player.id} className={player.id === agent.id ? "current" : ""}>
                  <i style={{ "--player-color": player.color } as CSSProperties} />
                  <span>{player.name}</span>
                  <b>{player.codename}</b>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="section-head compact">
              <div>
                <p>EVENTS</p>
                <h2>日志</h2>
              </div>
              <Shield aria-hidden="true" />
            </div>
            <div className="event-log">
              {logs.map((entry) => (
                <div key={entry.id} className="log-entry">
                  <span>{formatClock(entry.time)}</span>
                  <strong>{entry.text}</strong>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function AgentSprite({ agent, isLocal }: { agent: ArenaAgent; isLocal: boolean }) {
  return (
    <div
      className={`agent-sprite ${isLocal ? "local" : ""} ${agent.hp <= 0 ? "down" : ""}`}
      style={
        {
          "--x": `${agent.x}%`,
          "--y": `${agent.y}%`,
          "--agent-color": agent.color,
          "--angle": `${agent.angle}rad`,
          "--size": `${AGENT_RADIUS * 2}%`,
        } as CSSProperties
      }
    >
      <span>{agent.codename}</span>
      <i />
      <b>{Math.round(agent.hp)}</b>
    </div>
  );
}

function Meter({ label, value, tone }: { label: string; value: number; tone: "green" | "amber" | "red" }) {
  return (
    <div className={`test-meter ${tone}`}>
      <div>
        <span>{label}</span>
        <b>{Math.round(value)}</b>
      </div>
      <i>
        <em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </i>
    </div>
  );
}

function Diagnostic({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="diagnostic">
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
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

function normalizeKey(key: string) {
  const normalized = key.toLowerCase();
  if (["w", "a", "s", "d", "e", " ", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(normalized)) {
    return normalized === " " ? "space" : normalized;
  }
  return "";
}

function formatConnection(status: string) {
  if (status === "connected") return "已连接";
  if (status === "connecting") return "连接中";
  if (status === "missing-config") return "本地";
  if (status === "error") return "异常";
  return "待连接";
}

function formatClock(time: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(time));
}
