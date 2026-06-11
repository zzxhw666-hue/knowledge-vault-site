/**
 * 应用主组件 — 角色竞技场（Character Arena）。
 *
 * 包含完整的前端游戏逻辑：
 * 1. 大厅入口（Entry）— 选择角色、创建/加入房间
 * 2. 战斗房间（CharacterRoom）— 实时对战 UI 和游戏循环
 *
 * 游戏循环架构（requestAnimationFrame）：
 * - 每帧更新本地 agent 位置（WASD 移动 + 冲刺）
 * - 移动弹丸、检测碰撞、处理伤害
 * - 在核心区域站立即上传得分
 * - 检测道具拾取
 * - 定期广播 agent 状态给其他玩家（~80ms 间隔）
 *
 * 网络架构：
 * - 使用 useArenaRoom Hook 管理 Supabase Realtime 连接
 * - 每个客户端独立运行自己的物理模拟
 * - 通过 ArenaSignal 广播 agent 状态、弹丸、伤害、击杀事件
 * - 接收远程信号并更新远程 agent 的显示状态
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity, Copy, Crosshair, Gauge, Keyboard, LogIn,
  MousePointer2, Play, RadioTower, RotateCcw, Shield, Target, Users, Zap,
} from "lucide-react";
import {
  AGENT_RADIUS, ARENA_ZONES, CAPTURE_SECONDS, CORE_HEAL_PER_SECOND,
  DASH_COST, DASH_DISTANCE, ENERGY_REGEN_PER_SECOND, FIRE_COST,
  KILL_LIMIT, MAX_WEAPON_UPGRADES, MIN_ARENA_PLAYERS_TO_START,
  MOVE_SPEED, OVERDRIVE_RADIUS_MULTIPLIER, PROJECTILE_RADIUS,
  UPGRADE_RADIUS, UPGRADE_SPAWN_INTERVAL_MS,
  createProjectile, createArenaAgent, createUpgradeItem,
  distance, isUpgradeCollectible, isProjectileExpired,
  moveProjectile, isInCore, resolveAgentCollision,
  resolveProjectileCollision, respawnAgent,
} from "./game/arena";
import type { ArenaAgent, ArenaSignal, ArenaShot, ArenaUpgrade } from "./game/arena";
import { CHARACTER_PROFILES, CODENAMES, PLAYER_COLORS, getCharacterProfile } from "./game/config";
import type { PresencePlayer } from "./game/types";
import { useArenaRoom } from "./hooks/useArenaRoom";

// =============================================================================
// 类型定义
// =============================================================================

/** 房间会话（本地玩家的身份信息） */
interface RoomSession {
  roomCode: string;
  localPlayer: PresencePlayer;
}

/** 事件日志条目 */
interface LogEntry {
  id: string;
  time: number;
  text: string;
}

/** 视觉特效 — 碰撞/命中/回复效果 */
interface ImpactEffect {
  id: string;
  x: number;
  y: number;
  type: "hit" | "bounce" | "spark" | "heal" | "upgrade" | "shield";
  time: number;
}

/** 视觉特效 — 冲刺拖尾 */
interface DashTrail {
  id: string;
  previousX: number;
  previousY: number;
  x: number;
  y: number;
  color: string;
  time: number;
}

/** 冲刺状态（仅在冲刺持续期间存在） */
interface DashState {
  startedAt: number;
  endsAt: number;
  directionX: number;
  directionY: number;
  distance: number;
}

// =============================================================================
// 常量
// =============================================================================

/** localStorage 存储键名 */
const STORAGE_NAME_KEY = "intel-clash:name";
const STORAGE_COLOR_KEY = "intel-clash:color";
const STORAGE_CODENAME_KEY = "intel-clash:codename";

/** 是否显示本地测试工具（开发环境专用） */
const SHOW_LOCAL_TEST_TOOLS = import.meta.env.DEV;

/** 冲刺持续时间（毫秒） */
const DASH_DURATION_MS = 220;

/** 疾行包持续时长（毫秒） */
const HASTE_DURATION_MS = 8_000;

/** 护盾包持续时长（毫秒） */
const GUARD_DURATION_MS = 7_000;

// =============================================================================
// 主组件 — App
// =============================================================================

/**
 * 应用根组件。
 * 管理大厅 ↔ 战斗房间的切换，维护玩家身份和房间会话。
 */
export function App() {
  // --- 大厅状态 ---
  const initialRoom = getRoomFromHash();
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoom);
  const [nameInput, setNameInput] = useState(() => localStorage.getItem(STORAGE_NAME_KEY) ?? "");
  const [colorIndex, setColorIndex] = useState(() => Number(localStorage.getItem(STORAGE_COLOR_KEY) ?? 0) || 0);
  const [codenameIndex, setCodenameIndex] = useState(() => Number(localStorage.getItem(STORAGE_CODENAME_KEY) ?? 0) || 0);

  // --- 会话状态 ---
  const [session, setSession] = useState<RoomSession | null>(null);
  const [toast, setToast] = useState("");

  // 当前选中的角色
  const selectedCharacterIndex = normalizeIndex(colorIndex, CHARACTER_PROFILES.length);
  const selectedCharacter = CHARACTER_PROFILES[selectedCharacterIndex];

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /**
   * 进入房间。
   * 创建玩家身份，持久化选择偏好到 localStorage，设置 URL hash。
   */
  function beginRoom(code: string) {
    const trimmedName = nameInput.trim().slice(0, 16);
    const codename = CODENAMES[codenameIndex % CODENAMES.length];
    const playerName = trimmedName || codename;
    const roomCode = normalizeRoomCode(code || generateRoomCode());

    localStorage.setItem(STORAGE_NAME_KEY, playerName);
    localStorage.setItem(STORAGE_COLOR_KEY, String(colorIndex));
    localStorage.setItem(STORAGE_CODENAME_KEY, String(codenameIndex));

    // URL hash 用于分享房间链接
    window.location.hash = `room=${roomCode}`;
    setSession({
      roomCode,
      localPlayer: {
        id: createClientId(),
        name: playerName,
        color: PLAYER_COLORS[selectedCharacterIndex],
        codename,
        joinedAt: Date.now(),
      },
    });
  }

  // --- 渲染 ---

  // 已加入房间 → 渲染战斗界面
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

  // 大厅入口界面
  return (
    <main className="entry-shell">
      <section className="entry-stage">
        {/* 品牌标题 */}
        <div className="brand-lockup">
          <p>CHARACTER ARENA</p>
          <h1>情报暗战</h1>
        </div>

        <div className="entry-grid">
          {/* 左侧：创建房间面板 */}
          <section className="entry-panel">
            <div className="panel-title">
              <RadioTower aria-hidden="true" />
              <div>
                <h2>创建行动房间</h2>
                <p>用键盘移动角色，用鼠标瞄准和行动，朋友可用房间码加入。</p>
              </div>
            </div>

            {/* 昵称输入 */}
            <label>
              昵称
              <input
                value={nameInput}
                maxLength={16}
                placeholder="输入你的代号"
                onChange={(event) => setNameInput(event.target.value)}
              />
            </label>

            {/* 角色选择 */}
            <div className="field-group">
              <span>角色 / 特性</span>
              <div className="character-choice-grid">
                {CHARACTER_PROFILES.map((profile, index) => (
                  <button
                    key={profile.id}
                    type="button"
                    className={index === selectedCharacterIndex ? "character-choice selected" : "character-choice"}
                    style={{ "--swatch": profile.color } as CSSProperties}
                    aria-label={`选择角色 ${profile.name}`}
                    onClick={() => setColorIndex(index)}
                  >
                    <i />
                    <strong>{profile.name}</strong>
                    <span>{profile.traitTitle}</span>
                  </button>
                ))}
              </div>
              <p className="trait-note">{selectedCharacter.traitDescription}</p>
            </div>

            {/* 行动代号 */}
            <label>
              行动代号
              <select value={codenameIndex} onChange={(event) => setCodenameIndex(Number(event.target.value))}>
                {CODENAMES.map((codename, index) => (
                  <option key={codename} value={index}>{codename}</option>
                ))}
              </select>
            </label>

            {/* 创建房间按钮 */}
            <button className="primary-button" type="button" onClick={() => beginRoom(generateRoomCode())}>
              <Play aria-hidden="true" /> 创建房间
            </button>
          </section>

          {/* 右侧：加入房间面板 */}
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
              <Users aria-hidden="true" /> 加入房间
            </button>
          </section>
        </div>
      </section>

      {/* Toast 通知 */}
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}

// =============================================================================
// 战斗房间组件 — CharacterRoom
// =============================================================================

/**
 * 战斗房间组件。
 * 包含完整的游戏循环、输入处理、渲染逻辑。
 *
 * 游戏循环（requestAnimationFrame，60fps 目标）：
 * 1. 读取键盘输入 → 计算移动向量
 * 2. 处理冲刺状态（固定方向高速移动 220ms）
 * 3. 应用移动并检测障碍物碰撞
 * 4. 核心占领/回血检测
 * 5. 移动所有弹丸，检测碰撞（边界/障碍物/角色）
 * 6. 检测道具拾取
 * 7. 定期广播 agent 状态
 * 8. Overdrive 近身秒杀判定
 * 9. 清理过期特效和道具
 */
function CharacterRoom({
  session,
  onLeave,
  showToast,
}: {
  session: RoomSession;
  onLeave: () => void;
  showToast: (message: string) => void;
}) {
  // --- Refs（不触发重渲染，用于游戏循环中快速读取） ---
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const keysRef = useRef(new Set<string>());             // 当前按下的键
  const pointerRef = useRef({ x: 50, y: 50 });          // 鼠标位置（百分比）
  const lastBroadcastRef = useRef(0);                    // 上一次广播时间
  const lastHealEffectRef = useRef(0);                   // 上一次回血特效时间
  const lastEnergyWarningRef = useRef(0);                // 上一次能量警告时间
  const lastDashTrailRef = useRef(0);                    // 上一次冲刺拖尾时间
  const lastUpgradeSpawnAtRef = useRef(0);               // 上一次道具生成时间
  const upgradeSequenceRef = useRef(0);                  // 道具生成序列号
  const collectedUpgradeIdsRef = useRef(new Set<string>());     // 已拾取的道具 ID
  const processedDamageIdsRef = useRef(new Set<string>());      // 已处理的伤害 ID
  const processedEliminationIdsRef = useRef(new Set<string>()); // 已处理的击杀 ID
  const executedTargetIdsRef = useRef(new Set<string>());       // Overdrive 已执行目标 ID
  const dashStateRef = useRef<DashState | null>(null);   // 冲刺状态
  const roomStartedRef = useRef(false);                   // 房间是否已开始
  const weaponLevelRef = useRef(0);                       // 武器升级等级
  const overdriveRef = useRef(false);                     // Overdrive 状态
  const guardUntilRef = useRef(0);                        // 护盾结束时刻
  const hasteUntilRef = useRef(0);                        // 疾行结束时刻

  // --- State（触发重渲染，用于 UI 更新） ---
  const [captureProgress, setCaptureProgress] = useState(0);
  const [roomStarted, setRoomStarted] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [gameFinished, setGameFinished] = useState(false);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const [shots, setShots] = useState<ArenaShot[]>([]);
  const [impacts, setImpacts] = useState<ImpactEffect[]>([]);
  const [dashTrails, setDashTrails] = useState<DashTrail[]>([]);
  const [upgrades, setUpgrades] = useState<ArenaUpgrade[]>([]);
  const [weaponLevel, setWeaponLevel] = useState(0);
  const [hitFlashUntil, setHitFlashUntil] = useState<Record<string, number>>({});
  const [overdriveEnabled, setOverdriveEnabled] = useState(false);
  const [guardUntil, setGuardUntil] = useState(0);
  const [hasteUntil, setHasteUntil] = useState(0);
  const [damageFlash, setDamageFlash] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  // 本地 agent 和训练靶机
  const [agent, setAgent] = useState(() => createArenaAgent(session.localPlayer, Date.now()));
  const [bot, setBot] = useState<ArenaAgent | null>(() =>
    SHOW_LOCAL_TEST_TOOLS ? createTrainingTarget(Date.now()) : null
  );

  // --- Ref 同步（确保 useCallback 中访问最新值，避免闭包过期） ---
  const agentRef = useRef(agent);
  const botRef = useRef(bot);
  const remoteAgentsRef = useRef<Record<string, ArenaAgent>>({});
  const upgradesRef = useRef<ArenaUpgrade[]>([]);
  const sendSignalRef = useRef<(signal: ArenaSignal) => void>(() => {});

  // ===========================================================================
  // 工具方法
  // ===========================================================================

  /** 添加日志条目（最新在前，最多 8 条） */
  const addLog = useCallback((text: string) => {
    setLogs((entries) => [{ id: createClientId(), time: Date.now(), text }, ...entries].slice(0, 8));
  }, []);

  /** 添加命中/碰撞特效（最多 14 个同时活跃） */
  const addImpact = useCallback((x: number, y: number, type: ImpactEffect["type"]) => {
    setImpacts((items) => [...items.slice(-14), { id: createClientId(), x, y, type, time: Date.now() }]);
  }, []);

  /** 添加冲刺拖尾（最多 16 条） */
  const addDashTrail = useCallback((previousX: number, previousY: number, x: number, y: number, color: string) => {
    setDashTrails((items) => [
      ...items.slice(-16),
      { id: createClientId(), previousX, previousY, x, y, color, time: Date.now() },
    ]);
  }, []);

  /** 触发受击闪烁（520ms） */
  const flashAgent = useCallback((agentId: string) => {
    setHitFlashUntil((items) => ({ ...items, [agentId]: Date.now() + 520 }));
  }, []);

  /** 能量不足警告（850ms 冷却） */
  const warnEnergy = useCallback(() => {
    const now = Date.now();
    if (now - lastEnergyWarningRef.current < 850) return;
    lastEnergyWarningRef.current = now;
    addLog("能量不足，等待恢复。");
  }, [addLog]);

  /** 触发受伤害反馈（画面红色遮罩 + 震动 180ms） */
  const triggerDamageFeedback = useCallback(() => {
    setDamageFlash(true);
    setIsShaking(true);
    window.setTimeout(() => setDamageFlash(false), 180);
    window.setTimeout(() => setIsShaking(false), 180);
  }, []);

  /** 结束对局 */
  const finishGame = useCallback((nextWinnerId: string, time: number, broadcast = false) => {
    setGameFinished(true);
    setWinnerId(nextWinnerId);
    if (broadcast) {
      sendSignalRef.current({ type: "game-over", winnerId: nextWinnerId, time });
    }
  }, []);

  // ===========================================================================
  // 战斗逻辑
  // ===========================================================================

  /** 本地击杀计数 +1，达到 KILL_LIMIT 时结束对局 */
  const awardLocalKill = useCallback((time: number) => {
    setAgent((previous) => {
      const kills = previous.kills + 1;
      const next = { ...previous, kills, updatedAt: time };
      sendSignalRef.current({ type: "agent", agent: next });
      if (kills >= KILL_LIMIT) {
        finishGame(previous.id, time, true);
      }
      return next;
    });
  }, [finishGame]);

  /**
   * 本地 agent 受伤害。
   * 护盾 / Overdrive 免疫伤害，否则扣血并在 HP ≤ 0 时重生。
   */
  const damageLocalAgent = useCallback((damage: number, shooterId: string, damageId: string) => {
    // 防止重复处理同一发弹丸的伤害
    if (processedDamageIdsRef.current.has(damageId)) return;
    processedDamageIdsRef.current.add(damageId);

    // 护盾 / Overdrive → 免疫
    if (overdriveRef.current || Date.now() < guardUntilRef.current) {
      addImpact(agentRef.current.x, agentRef.current.y, "shield");
      return;
    }

    triggerDamageFeedback();
    setAgent((previous) => {
      flashAgent(previous.id);
      const hp = Math.max(0, previous.hp - damage);
      addImpact(previous.x, previous.y, "hit");

      // 被击杀
      if (hp <= 0) {
        const now = Date.now();
        const next = respawnAgent({ ...previous, hp, deaths: previous.deaths + 1 }, now, 0);
        addLog("你被击倒，已重新部署。");
        sendSignalRef.current({ type: "elimination", killerId: shooterId, targetId: previous.id, time: now });
        sendSignalRef.current({ type: "agent", agent: next });
        return next;
      }

      addLog("你被脉冲命中。");
      const next = { ...previous, hp, action: "hit" as const, updatedAt: Date.now() };
      sendSignalRef.current({ type: "agent", agent: next });
      return next;
    });
  }, [addImpact, addLog, flashAgent, triggerDamageFeedback]);

  /** 训练靶机受伤（开发环境专用） */
  const damageTrainingTarget = useCallback((damage: number) => {
    if (!SHOW_LOCAL_TEST_TOOLS) return;
    setBot((previous) => {
      if (!previous) return previous;
      flashAgent(previous.id);
      const hp = Math.max(0, previous.hp - damage);
      addImpact(previous.x, previous.y, "hit");
      if (hp <= 0) {
        addLog("训练靶机被击倒，正在重置。");
        awardLocalKill(Date.now());
        // 900ms 后自动重生
        window.setTimeout(() => setBot(respawnAgent(previous, Date.now(), 1)), 900);
        return { ...previous, hp, action: "down", updatedAt: Date.now() };
      }
      return { ...previous, hp, action: "hit", updatedAt: Date.now() };
    });
  }, [addImpact, addLog, awardLocalKill, flashAgent]);

  // ===========================================================================
  // 远程信号处理
  // ===========================================================================

  /**
   * 处理来自远程玩家的 ArenaSignal。
   * 根据信号类型更新对应的本地状态。
   */
  const handleSignal = useCallback(
    (signal: ArenaSignal) => {
      // 房间开始 → 重置所有战斗状态
      if (signal.type === "room-start") {
        const wasStarted = roomStartedRef.current;
        setRoomStarted(true);
        setStartedAt(signal.startedAt);
        if (!wasStarted) {
          setGameFinished(false);
          setWinnerId(null);
          setCaptureProgress(0);
          setWeaponLevel(0);
          setGuardUntil(0);
          setHasteUntil(0);
          setOverdriveEnabled(false);
          processedDamageIdsRef.current.clear();
          processedEliminationIdsRef.current.clear();
          collectedUpgradeIdsRef.current.clear();
          guardUntilRef.current = 0;
          hasteUntilRef.current = 0;
          overdriveRef.current = false;
          setAgent((previous) => createArenaAgent(previous, signal.startedAt));
        }
        roomStartedRef.current = true;
        lastUpgradeSpawnAtRef.current = signal.startedAt;
        if (!wasStarted) addLog("房主已开始行动。");
        return;
      }
      // 弹丸 → 添加到渲染列表
      if (signal.type === "shot") {
        setShots((items) => [...items.slice(-14), signal.shot]);
        return;
      }
      // 道具生成
      if (signal.type === "upgrade-spawn") {
        setUpgrades((items) => {
          if (items.some((item) => item.id === signal.upgrade.id)) return items;
          return [...items, signal.upgrade].slice(-4);
        });
        return;
      }
      // 道具被拾取
      if (signal.type === "upgrade-collect") {
        setUpgrades((items) => items.filter((item) => item.id !== signal.upgradeId));
        if (signal.playerId !== session.localPlayer.id) {
          addLog("对手获取了弹道升级。");
        }
        return;
      }
      // 伤害 → 仅处理以本地玩家为目标的伤害
      if (signal.type === "damage") {
        if (signal.targetId === session.localPlayer.id) {
          damageLocalAgent(signal.damage, signal.shooterId, signal.shotId);
        }
        return;
      }
      // 击杀
      if (signal.type === "elimination") {
        const eliminationId = `${signal.killerId}:${signal.targetId}:${signal.time}`;
        if (processedEliminationIdsRef.current.has(eliminationId)) return;
        processedEliminationIdsRef.current.add(eliminationId);
        if (signal.killerId === session.localPlayer.id) {
          awardLocalKill(signal.time);
          addLog("击杀确认。");
        } else if (signal.targetId === session.localPlayer.id) {
          addLog("你被击杀。");
        } else {
          addLog("场上发生一次击杀。");
        }
        return;
      }
      // 对局结束
      if (signal.type === "game-over") {
        finishGame(signal.winnerId, signal.time);
        addLog("击杀上限达成，行动结束。");
        return;
      }
      // 核心上传得分（远程玩家）
      if (signal.type === "score" && signal.playerId !== session.localPlayer.id) {
        addLog("对手完成了一次核心上传。");
      }
    },
    [addLog, awardLocalKill, damageLocalAgent, finishGame, session.localPlayer.id]
  );

  // ===========================================================================
  // 实时房间连接
  // ===========================================================================

  const {
    connectionStatus,
    errorMessage,
    presencePlayers,
    remoteAgents,
    sendSignal,
    patchRemoteAgent,
  } = useArenaRoom({
    roomCode: session.roomCode,
    localPlayer: session.localPlayer,
    onSignal: handleSignal,
  });

  // 计算 Host 和权限
  const hostId = presencePlayers[0]?.id ?? session.localPlayer.id;
  const isHost = hostId === session.localPlayer.id;
  const canStartRoom = presencePlayers.length >= MIN_ARENA_PLAYERS_TO_START || SHOW_LOCAL_TEST_TOOLS;
  const localProfile = getCharacterProfile(session.localPlayer.color);
  const fireEnergyCost = FIRE_COST * localProfile.stats.fireCost;
  const dashEnergyCost = DASH_COST;

  // --- 同步 Ref ---
  useEffect(() => { sendSignalRef.current = sendSignal; }, [sendSignal]);
  useEffect(() => { agentRef.current = agent; }, [agent]);
  useEffect(() => { botRef.current = bot; }, [bot]);
  useEffect(() => { remoteAgentsRef.current = remoteAgents; }, [remoteAgents]);
  useEffect(() => { upgradesRef.current = upgrades; }, [upgrades]);
  useEffect(() => { weaponLevelRef.current = weaponLevel; }, [weaponLevel]);
  useEffect(() => { roomStartedRef.current = roomStarted; }, [roomStarted]);
  useEffect(() => { overdriveRef.current = overdriveEnabled; }, [overdriveEnabled]);
  useEffect(() => { guardUntilRef.current = guardUntil; }, [guardUntil]);
  useEffect(() => { hasteUntilRef.current = hasteUntil; }, [hasteUntil]);

  // 当玩家列表变化时，Host 重新广播 room-start 和已有道具
  useEffect(() => {
    if (!isHost || !roomStarted || !startedAt) return;
    sendSignal({ type: "room-start", startedBy: session.localPlayer.id, startedAt });
    for (const upgrade of upgradesRef.current) {
      sendSignal({ type: "upgrade-spawn", upgrade });
    }
  }, [isHost, presencePlayers.length, roomStarted, sendSignal, session.localPlayer.id, startedAt]);

  // ===========================================================================
  // 道具系统
  // ===========================================================================

  /** 生成一个新道具 */
  const spawnUpgrade = useCallback(
    (now: number) => {
      const upgrade = createUpgradeItem(`upgrade-${now}-${upgradeSequenceRef.current}`, now, upgradeSequenceRef.current);
      upgradeSequenceRef.current += 1;
      setUpgrades((items) => [...items.filter((item) => item.expiresAt > now), upgrade].slice(-4));
      sendSignal({ type: "upgrade-spawn", upgrade });
      addLog("地图生成了弹道升级。");
    },
    [addLog, sendSignal]
  );

  /** 拾取道具并应用效果 */
  const collectUpgrade = useCallback(
    (upgrade: ArenaUpgrade) => {
      if (collectedUpgradeIdsRef.current.has(upgrade.id)) return;
      collectedUpgradeIdsRef.current.add(upgrade.id);
      setUpgrades((items) => items.filter((item) => item.id !== upgrade.id));
      addImpact(upgrade.x, upgrade.y, "upgrade");

      // 根据道具类型应用不同效果
      if (upgrade.kind === "splitter") {
        // 弹道升级：每次射击 +1 枚子弹
        setWeaponLevel((level) => Math.min(MAX_WEAPON_UPGRADES, level + 1));
        addLog("弹道升级获取：每次射击 +1 枚子弹。");
      }
      if (upgrade.kind === "medkit") {
        // 急救包：恢复 45 HP
        setAgent((previous) => {
          const profile = getCharacterProfile(previous.color);
          const next = { ...previous, hp: Math.min(profile.stats.maxHp, previous.hp + 45), action: "heal" as const, updatedAt: Date.now() };
          sendSignalRef.current({ type: "agent", agent: next });
          return next;
        });
        addLog("急救包获取：生命恢复。");
      }
      if (upgrade.kind === "battery") {
        // 能量包：恢复 60 能量
        setAgent((previous) => {
          const next = { ...previous, energy: Math.min(100, previous.energy + 60), updatedAt: Date.now() };
          sendSignalRef.current({ type: "agent", agent: next });
          return next;
        });
        addLog("能量包获取：共用能量恢复。");
      }
      if (upgrade.kind === "haste") {
        // 疾行包：8 秒内移动速度 +28%
        const until = Date.now() + HASTE_DURATION_MS;
        setHasteUntil(until);
        hasteUntilRef.current = until;
        addLog("疾行包获取：移动速度短暂提升。");
      }
      if (upgrade.kind === "guard") {
        // 护盾包：7 秒内无敌
        const until = Date.now() + GUARD_DURATION_MS;
        setGuardUntil(until);
        guardUntilRef.current = until;
        addImpact(upgrade.x, upgrade.y, "shield");
        addLog("护盾包获取：短暂无敌。");
      }

      sendSignal({ type: "upgrade-collect", upgradeId: upgrade.id, playerId: session.localPlayer.id, time: Date.now() });
    },
    [addImpact, addLog, sendSignal, session.localPlayer.id]
  );

  /**
   * 对远程 agent 造成伤害。
   * 更新显示状态 → 广播 damage 信号。
   */
  const damageRemoteAgent = useCallback(
    (target: ArenaAgent, damage: number, damageId: string) => {
      addImpact(target.x, target.y, "hit");
      flashAgent(target.id);
      patchRemoteAgent(target.id, (agent) => ({
        ...agent,
        hp: Math.max(0, agent.hp - damage),
        action: "hit",
        updatedAt: Date.now(),
      }));
      sendSignal({
        type: "damage",
        targetId: target.id,
        shooterId: session.localPlayer.id,
        shotId: damageId,
        damage,
        time: Date.now(),
      });
    },
    [addImpact, flashAgent, patchRemoteAgent, sendSignal, session.localPlayer.id]
  );

  // ===========================================================================
  // 初始化
  // ===========================================================================

  useEffect(() => {
    arenaRef.current?.focus();
    addLog("行动场已加载。WASD 移动，鼠标瞄准。");
  }, [addLog]);

  // ===========================================================================
  // 键盘输入处理
  // ===========================================================================

  /**
   * 监听全局键盘事件。
   * M 键 → 切换 Overdrive 模式
   * 空格 → 射击
   * Shift → 冲刺
   * WASD/方向键 → 移动
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // M 键切换 Overdrive
      if (event.key.toLowerCase() === "m" && !event.repeat) {
        event.preventDefault();
        setOverdriveEnabled((enabled) => {
          const nextEnabled = !enabled;
          overdriveRef.current = nextEnabled;
          setAgent((previous) => {
            const next = { ...previous, isOverdrive: nextEnabled, updatedAt: Date.now() };
            sendSignalRef.current({ type: "agent", agent: next });
            return next;
          });
          return nextEnabled;
        });
        return;
      }

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
  }, [dash, fire]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===========================================================================
  // 游戏主循环（requestAnimationFrame）
  // ===========================================================================

  /**
   * 游戏主循环。
   * 每帧执行：移动 → 碰撞 → 占领/回血 → 弹丸物理 → 拾取检测 → 广播
   * 仅在 roomStarted && !gameFinished 时运行。
   */
  useEffect(() => {
    if (!roomStarted || gameFinished) return;
    let frame = 0;
    let lastTime = performance.now();

    const step = (time: number) => {
      // 限制 delta 最大 50ms（避免切后台后追赶过猛）
      const elapsed = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;
      const now = Date.now();
      const keys = keysRef.current;

      // 到期清除增益效果
      if (guardUntilRef.current && now >= guardUntilRef.current) {
        guardUntilRef.current = 0;
        setGuardUntil(0);
      }
      if (hasteUntilRef.current && now >= hasteUntilRef.current) {
        hasteUntilRef.current = 0;
        setHasteUntil(0);
      }

      // Host 定期生成道具
      if (isHost && now - lastUpgradeSpawnAtRef.current >= UPGRADE_SPAWN_INTERVAL_MS) {
        lastUpgradeSpawnAtRef.current = now;
        spawnUpgrade(now);
      }

      // --- 更新本地 agent ---
      setAgent((previous) => {
        const profile = getCharacterProfile(previous.color);
        const hasteMultiplier = hasteUntilRef.current > now ? 1.28 : 1;
        const pointer = pointerRef.current;
        // 朝向始终指向鼠标位置
        const angle = Math.atan2(pointer.y - previous.y, pointer.x - previous.x);

        // 当前是否有活跃的冲刺
        const activeDash = dashStateRef.current && now < dashStateRef.current.endsAt ? dashStateRef.current : null;
        if (dashStateRef.current && now >= dashStateRef.current.endsAt) {
          dashStateRef.current = null;
        }

        let moveX = 0;
        let moveY = 0;
        let isMoving = false;

        if (activeDash) {
          // 冲刺模式：沿固定方向高速移动
          const dashStep = (activeDash.distance / (DASH_DURATION_MS / 1000)) * elapsed;
          moveX = activeDash.directionX * dashStep;
          moveY = activeDash.directionY * dashStep;
          isMoving = true;
        } else {
          // 常规移动：WASD / 方向键
          let dx = 0;
          let dy = 0;
          if (keys.has("w") || keys.has("arrowup"))    dy -= 1;
          if (keys.has("s") || keys.has("arrowdown"))  dy += 1;
          if (keys.has("a") || keys.has("arrowleft"))  dx -= 1;
          if (keys.has("d") || keys.has("arrowright")) dx += 1;

          const length = Math.hypot(dx, dy) || 1;
          isMoving = dx !== 0 || dy !== 0;
          moveX = (dx / length) * MOVE_SPEED * profile.stats.moveSpeed * hasteMultiplier * elapsed;
          moveY = (dy / length) * MOVE_SPEED * profile.stats.moveSpeed * hasteMultiplier * elapsed;
        }

        let score = previous.score;

        // 应用移动并检查障碍物碰撞
        const baseNext = resolveAgentCollision({
          ...previous,
          x: previous.x + moveX,
          y: previous.y + moveY,
          angle,
          energy: Math.min(100, previous.energy + ENERGY_REGEN_PER_SECOND * profile.stats.energyRegen * elapsed),
          score,
          action: activeDash ? "dash" : isMoving ? "move" : "idle",
          updatedAt: now,
        });

        // 核心占领检测（按住 E 键且在核心区域内）
        const isCapturing = keys.has("e") && isInCore(baseNext);
        // 核心回血检测（在核心区域内且未满血）
        const isHealing = isInCore(baseNext) && baseNext.hp < profile.stats.maxHp;

        // 更新占领进度条
        if (isCapturing) {
          setCaptureProgress((progress) => {
            const next = Math.min(100, progress + (elapsed / CAPTURE_SECONDS) * 100);
            if (next >= 100 && progress < 100) {
              score += 1;
              addLog("核心上传完成，得分 +1。");
              sendSignal({ type: "score", playerId: previous.id, score, time: now });
              return 0; // 完成后重置进度
            }
            return next;
          });
        } else {
          setCaptureProgress((progress) => Math.max(0, progress - elapsed * 18));
        }

        // 核心回血
        const healedHp = isHealing
          ? Math.min(profile.stats.maxHp, baseNext.hp + CORE_HEAL_PER_SECOND * profile.stats.healing * elapsed)
          : baseNext.hp;

        const next = {
          ...baseNext,
          hp: healedHp,
          score,
          action: isCapturing ? "capture" : isHealing ? "heal" : baseNext.action,
        };

        // 回血视觉特效（每 360ms 一次）
        if (isHealing && now - lastHealEffectRef.current > 360) {
          lastHealEffectRef.current = now;
          addImpact(next.x, next.y, "heal");
        }

        // 冲刺拖尾（每 24ms 一条）
        if (activeDash && now - lastDashTrailRef.current > 24) {
          lastDashTrailRef.current = now;
          addDashTrail(previous.x, previous.y, next.x, next.y, previous.color);
        }

        // 定期广播 agent 状态（~80ms 间隔）
        if (time - lastBroadcastRef.current > 80) {
          lastBroadcastRef.current = time;
          sendSignal({ type: "agent", agent: next });
        }

        return next;
      });

      // --- 更新弹丸 ---
      setShots((items) => {
        // 收集所有可能的碰撞目标
        const trainingTargets = SHOW_LOCAL_TEST_TOOLS && botRef.current ? [botRef.current] : [];
        const targets = [agentRef.current, ...trainingTargets, ...Object.values(remoteAgentsRef.current)];
        const nextShots: ArenaShot[] = [];

        for (const shot of items) {
          // 过期弹丸 → 火花特效
          if (isProjectileExpired(shot, now)) {
            addImpact(shot.x, shot.y, "spark");
            continue;
          }

          const movedShot = moveProjectile(shot, elapsed);
          const collision = resolveProjectileCollision(movedShot);
          const resolvedShot = collision.shot;

          // 反弹 / 过期特效
          if (collision.bounced) addImpact(collision.impactX, collision.impactY, "bounce");
          if (collision.expired) {
            addImpact(collision.impactX, collision.impactY, "spark");
            continue;
          }

          // 检测角色碰撞（排除 260ms 内的自伤）
          const target = targets.find((candidate) => {
            if (candidate.hp <= 0) return false;
            if (candidate.id === resolvedShot.shooterId && now - resolvedShot.time < 260) return false;
            return distance(candidate, resolvedShot) <= AGENT_RADIUS + PROJECTILE_RADIUS + 0.7;
          });

          if (target) {
            flashAgent(target.id);
            // 根据目标身份调用不同的伤害处理
            if (target.id === agentRef.current.id && resolvedShot.shooterId !== agentRef.current.id) {
              addImpact(target.x, target.y, "hit");
            } else if (SHOW_LOCAL_TEST_TOOLS && target.id === botRef.current?.id) {
              damageTrainingTarget(resolvedShot.damage);
            } else if (resolvedShot.shooterId === agentRef.current.id && target.id !== agentRef.current.id) {
              damageRemoteAgent(target, resolvedShot.damage, resolvedShot.id);
            } else {
              addImpact(target.x, target.y, "hit");
            }
            continue; // 弹丸命中后消失
          }

          nextShots.push(resolvedShot);
        }

        return nextShots.slice(-16); // 最多 16 枚弹丸
      });

      // --- 道具拾取检测 ---
      const pickup = upgradesRef.current.find(
        (upgrade) => upgrade.expiresAt > now && isUpgradeCollectible(agentRef.current, upgrade)
      );
      if (pickup) collectUpgrade(pickup);

      // --- Overdrive 近身秒杀 ---
      if (overdriveRef.current) {
        const localAgent = agentRef.current;
        const crushRadius = AGENT_RADIUS * OVERDRIVE_RADIUS_MULTIPLIER + AGENT_RADIUS;
        for (const target of Object.values(remoteAgentsRef.current)) {
          if (target.hp <= 0 || executedTargetIdsRef.current.has(target.id)) continue;
          if (distance(localAgent, target) > crushRadius) continue;
          executedTargetIdsRef.current.add(target.id);
          // 1400ms 冷却，防止重复触发
          window.setTimeout(() => executedTargetIdsRef.current.delete(target.id), 1400);
          damageRemoteAgent(target, 9999, `overdrive:${localAgent.id}:${target.id}:${now}`);
          addImpact(target.x, target.y, "hit");
        }
        // 训练靶机也可以被 Overdrive 秒杀
        if (SHOW_LOCAL_TEST_TOOLS && botRef.current && botRef.current.hp > 0 && distance(localAgent, botRef.current) <= crushRadius) {
          damageTrainingTarget(9999);
        }
      }

      // --- 清理过期对象 ---
      setUpgrades((items) => items.filter((upgrade) => upgrade.expiresAt > now));
      setImpacts((items) => items.filter((impact) => now - impact.time < 700));
      setDashTrails((items) => items.filter((trail) => now - trail.time < 460));
      setHitFlashUntil((items) => {
        const activeEntries = Object.entries(items).filter(([, until]) => until > now);
        return activeEntries.length === Object.keys(items).length ? items : Object.fromEntries(activeEntries);
      });

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [
    addDashTrail, addImpact, addLog, collectUpgrade,
    damageRemoteAgent, damageLocalAgent, damageTrainingTarget,
    flashAgent, gameFinished, isHost, roomStarted, sendSignal, spawnUpgrade,
  ]);

  // ===========================================================================
  // 派生数据
  // ===========================================================================

  /** 在线 agent 列表（本地 + 远程 + 训练靶机，过滤 5 秒无更新的远程 agent） */
  const onlineAgents = useMemo(() => {
    const remote = Object.values(remoteAgents).filter(
      (remoteAgent) => Date.now() - remoteAgent.updatedAt < 5000
    );
    const target = SHOW_LOCAL_TEST_TOOLS && bot && bot.hp > 0 ? [bot] : [];
    return [agent, ...remote, ...target];
  }, [agent, bot, remoteAgents]);

  // ===========================================================================
  // 操作方法
  // ===========================================================================

  /** 复制房间链接到剪贴板 */
  function copyRoom() {
    const url = `${window.location.origin}${window.location.pathname}#room=${session.roomCode}`;
    void navigator.clipboard?.writeText(url);
    showToast("房间链接已复制。");
  }

  /** 房主开始对局 */
  function startRoom() {
    if (!isHost) { addLog("等待房主开始行动。"); return; }
    if (!canStartRoom) { addLog("至少需要 2 名玩家才能开始。"); return; }

    const now = Date.now();
    setRoomStarted(true);
    setStartedAt(now);
    setGameFinished(false);
    setWinnerId(null);
    setCaptureProgress(0);
    setShots([]);
    setImpacts([]);
    setDashTrails([]);
    setUpgrades([]);
    setWeaponLevel(0);
    setGuardUntil(0);
    setHasteUntil(0);
    setOverdriveEnabled(false);
    collectedUpgradeIdsRef.current.clear();
    processedDamageIdsRef.current.clear();
    processedEliminationIdsRef.current.clear();
    dashStateRef.current = null;
    guardUntilRef.current = 0;
    hasteUntilRef.current = 0;
    overdriveRef.current = false;
    roomStartedRef.current = true;
    lastUpgradeSpawnAtRef.current = now;
    setAgent((previous) => createArenaAgent(previous, now));
    addLog("行动开始。");
    sendSignal({ type: "room-start", startedBy: session.localPlayer.id, startedAt: now });
  }

  /** 更新鼠标/触摸指针位置 */
  function updatePointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  }

  /**
   * 射击。
   * 消耗能量，发射 1 + 额外弹丸 枚子弹，散布角度随弹丸数增大。
   */
  function fire() {
    if (!roomStartedRef.current || gameFinished) return;
    const shooter = agentRef.current;
    const profile = getCharacterProfile(shooter.color);
    const energyCost = FIRE_COST * profile.stats.fireCost;
    if (shooter.energy < energyCost || shooter.hp <= 0) { warnEnergy(); return; }

    const now = Date.now();
    // 计算弹丸数量（基础 1 + 角色特性 + 武器升级）
    const shotCount = Math.min(
      1 + profile.stats.extraProjectiles + weaponLevelRef.current,
      1 + MAX_WEAPON_UPGRADES + 1
    );
    // 散布步长（弹丸越多散布越大）
    const spreadStep = shotCount <= 1 ? 0 : Math.min(0.22, 0.08 + shotCount * 0.018);

    const shotsToFire = Array.from({ length: shotCount }, (_, index) => {
      const offset = (index - (shotCount - 1) / 2) * spreadStep;
      const isCenter = Math.abs(offset) < 0.001;
      return createProjectile(shooter, createClientId(), now, {
        angleOffset: offset,
        damageMultiplier: isCenter ? 1 : 0.84, // 非中心弹丸伤害略低
      });
    });

    setAgent((previous) => ({
      ...previous,
      energy: Math.max(0, previous.energy - energyCost),
      action: "fire",
      updatedAt: now,
    }));
    setShots((items) => [...items.slice(-14), ...shotsToFire]);
    for (const shot of shotsToFire) {
      sendSignal({ type: "shot", shot });
    }
    addLog(shotCount > 1 ? `散射脉冲发射：${shotCount} 枚弹道。` : "脉冲弹道发射。");
  }

  /**
   * 冲刺（Dash）。
   * 沿当前移动方向或朝向方向高速移动 220ms，消耗能量。
   */
  function dash() {
    if (!roomStartedRef.current || gameFinished) return;
    const current = agentRef.current;
    if (current.energy < dashEnergyCost || current.hp <= 0 || dashStateRef.current) {
      if (current.energy < dashEnergyCost) warnEnergy();
      return;
    }

    // 方向优先级：WASD 输入 > 当前朝向
    const keys = keysRef.current;
    let dx = 0;
    let dy = 0;
    if (keys.has("w") || keys.has("arrowup"))    dy -= 1;
    if (keys.has("s") || keys.has("arrowdown"))  dy += 1;
    if (keys.has("a") || keys.has("arrowleft"))  dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;

    const length = Math.hypot(dx, dy);
    const directionX = length > 0 ? dx / length : Math.cos(current.angle);
    const directionY = length > 0 ? dy / length : Math.sin(current.angle);
    const profile = getCharacterProfile(current.color);
    const now = Date.now();

    dashStateRef.current = {
      startedAt: now,
      endsAt: now + DASH_DURATION_MS,
      directionX,
      directionY,
      distance: DASH_DISTANCE * profile.stats.dashDistance,
    };
    setAgent((previous) => ({
      ...previous,
      energy: Math.max(0, previous.energy - dashEnergyCost),
      action: "dash",
      updatedAt: now,
    }));
    addDashTrail(current.x, current.y, current.x + directionX * 5, current.y + directionY * 5, current.color);
    addLog("滑行启动。");
  }

  /** 重置本地测试状态（开发环境） */
  function resetLocalTest() {
    if (!SHOW_LOCAL_TEST_TOOLS) return;
    const now = Date.now();
    setAgent(createArenaAgent(session.localPlayer, now));
    setBot(createTrainingTarget(now));
    setCaptureProgress(0);
    setShots([]);
    setImpacts([]);
    setDashTrails([]);
    setUpgrades([]);
    setWeaponLevel(0);
    setGuardUntil(0);
    setHasteUntil(0);
    setOverdriveEnabled(false);
    dashStateRef.current = null;
    guardUntilRef.current = 0;
    hasteUntilRef.current = 0;
    overdriveRef.current = false;
    collectedUpgradeIdsRef.current.clear();
    processedDamageIdsRef.current.clear();
    processedEliminationIdsRef.current.clear();
    addLog("本地测试状态已重置。");
  }

  // ===========================================================================
  // 渲染 — 战斗房间界面
  // ===========================================================================

  return (
    <main className="game-shell">
      {/* 顶部导航栏 */}
      <header className="topbar">
        <div className="brand-inline">
          <RadioTower aria-hidden="true" />
          <div>
            <p>REALTIME CHARACTER ARENA</p>
            <h1>情报暗战</h1>
          </div>
        </div>

        <div className="room-actions">
          {/* 复制房间链接 */}
          <button className="icon-text-button" type="button" onClick={copyRoom}>
            <Copy aria-hidden="true" /> {session.roomCode}
          </button>
          {/* 连接状态指示器 */}
          <span className={`status-pill ${connectionStatus}`}>
            {formatConnection(connectionStatus)}
          </span>
          {/* 离开按钮 */}
          <button className="ghost-button" type="button" onClick={onLeave}>离开</button>
        </div>
      </header>

      {/* 错误/警告横幅 */}
      {errorMessage ? <div className="system-banner">{errorMessage}</div> : null}
      {connectionStatus === "missing-config" ? (
        <div className="system-banner">未找到 Supabase 配置，当前只能本机试玩。</div>
      ) : null}

      {/* 未开始 → 显示大厅等待界面 */}
      {!roomStarted ? (
        <RoomLobby
          roomCode={session.roomCode}
          localPlayerId={session.localPlayer.id}
          hostId={hostId}
          players={presencePlayers}
          canStart={canStartRoom}
          isHost={isHost}
          onStart={startRoom}
        />
      ) : (
        /* 已开始 → 显示战场界面 */
        <section className="arena-layout with-rail">
          {/* 战场画布（核心游戏区域） */}
          <section className="arena-card">
            <div className="section-head">
              <div>
                <p>WASD / MOUSE</p>
                <h2>行动场</h2>
              </div>
              {SHOW_LOCAL_TEST_TOOLS ? (
                <button className="secondary-button" type="button" onClick={resetLocalTest}>
                  <RotateCcw aria-hidden="true" /> 重置测试
                </button>
              ) : null}
            </div>

            {/* 战场画布：鼠标/触摸输入 + 聚焦 */}
            <div
              ref={arenaRef}
              className={`character-arena ${isShaking ? "shake" : ""}`}
              tabIndex={0}
              onPointerMove={updatePointer}
              onPointerDown={(event) => {
                updatePointer(event);
                if (event.button === 0) fire();    // 左键射击
                if (event.button === 2) dash();    // 右键冲刺
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              {/* 战场区域（核心、中继站、掩体） */}
              {ARENA_ZONES.map((zone) => (
                <div
                  key={zone.id}
                  className={`arena-zone ${zone.kind} ${zone.kind !== "core" ? "solid" : ""}`}
                  style={{
                    "--x": `${zone.x}%`,
                    "--y": `${zone.y}%`,
                    "--r": `${zone.radius * 2}%`,
                  } as CSSProperties}
                >
                  <span>{zone.label}</span>
                </div>
              ))}

              {/* 冲刺拖尾 */}
              {dashTrails.map((trail) => {
                const length = Math.max(2.4, Math.hypot(trail.x - trail.previousX, trail.y - trail.previousY));
                return (
                  <div
                    key={trail.id}
                    className="dash-trail"
                    style={{
                      "--x": `${trail.previousX}%`,
                      "--y": `${trail.previousY}%`,
                      "--angle": `${Math.atan2(trail.y - trail.previousY, trail.x - trail.previousX)}rad`,
                      "--length": `${length}%`,
                      "--trail-color": trail.color,
                    } as CSSProperties}
                  />
                );
              })}

              {/* 升级道具 */}
              {upgrades.map((upgrade) => (
                <div
                  key={upgrade.id}
                  className="upgrade-pickup"
                  style={{
                    "--x": `${upgrade.x}%`,
                    "--y": `${upgrade.y}%`,
                    "--r": `${UPGRADE_RADIUS * 2}%`,
                  } as CSSProperties}
                >
                  <Zap aria-hidden="true" />
                  <span>{upgrade.label}</span>
                </div>
              ))}

              {/* 弹丸图层 */}
              {shots.map((shot) => {
                const trailLength = Math.max(2.4, Math.hypot(shot.x - shot.previousX, shot.y - shot.previousY));
                return (
                  <div key={shot.id} className="projectile-layer">
                    {/* 弹丸拖尾 */}
                    <div
                      className="projectile-trail"
                      style={{
                        "--x": `${shot.previousX}%`,
                        "--y": `${shot.previousY}%`,
                        "--angle": `${Math.atan2(shot.y - shot.previousY, shot.x - shot.previousX)}rad`,
                        "--length": `${trailLength}%`,
                      } as CSSProperties}
                    />
                    {/* 弹丸主体 */}
                    <div
                      className="projectile"
                      style={{
                        "--x": `${shot.x}%`,
                        "--y": `${shot.y}%`,
                        "--angle": `${shot.angle}rad`,
                      } as CSSProperties}
                    />
                  </div>
                );
              })}

              {/* 碰撞特效（命中/反弹/火花/回血/升级/护盾） */}
              {impacts.map((impact) => (
                <div
                  key={impact.id}
                  className={`impact-effect ${impact.type}`}
                  style={{ "--x": `${impact.x}%`, "--y": `${impact.y}%` } as CSSProperties}
                />
              ))}

              {/* 受伤害红色遮罩 */}
              {damageFlash ? <div className="damage-vignette" /> : null}

              {/* 角色精灵 */}
              {onlineAgents.map((arenaAgent) => (
                <AgentSprite
                  key={arenaAgent.id}
                  agent={arenaAgent}
                  isLocal={arenaAgent.id === agent.id}
                  isFlashing={Boolean(hitFlashUntil[arenaAgent.id])}
                />
              ))}

              {/* 对局结束覆盖层 */}
              {gameFinished ? (
                <div className="arena-end-overlay">
                  <Shield aria-hidden="true" />
                  <strong>{winnerId === agent.id ? "你已达成 20 杀" : "行动结束"}</strong>
                  <span>{winnerId ? `胜者 ${formatShortId(winnerId)}` : "击杀上限达成"}</span>
                </div>
              ) : null}
            </div>
          </section>

          {/* 右侧信息面板 */}
          <aside className="game-rail">
            {/* 玩家状态 HUD */}
            <section className="panel">
              <div className="section-head compact">
                <div><p>STATUS</p><h2>你的状态</h2></div>
                <Gauge aria-hidden="true" />
              </div>
              <PlayerHud
                agent={agent}
                weaponLevel={weaponLevel}
                fireCost={fireEnergyCost}
                dashCost={dashEnergyCost}
                captureProgress={captureProgress}
                guardUntil={guardUntil}
                hasteUntil={hasteUntil}
              />
            </section>

            {/* 房间信息 */}
            <section className="panel">
              <div className="section-head compact">
                <div><p>ROOM</p><h2>房间信息</h2></div>
                <MousePointer2 aria-hidden="true" />
              </div>
              <RoomSummary
                roomCode={session.roomCode}
                startedAt={startedAt}
                hostId={hostId}
                players={presencePlayers}
                localPlayerId={agent.id}
              />
            </section>

            {/* 击杀榜 */}
            <section className="panel">
              <div className="section-head compact">
                <div><p>{KILL_LIMIT} KILLS</p><h2>击杀榜</h2></div>
                <Target aria-hidden="true" />
              </div>
              <KillBoard agents={onlineAgents} winnerId={winnerId} />
            </section>

            {/* 操控说明 */}
            <section className="panel">
              <div className="section-head compact">
                <div><p>CONTROLS</p><h2>操控</h2></div>
                <Keyboard aria-hidden="true" />
              </div>
              <div className="control-list">
                <span>WASD / 方向键</span><b>移动</b>
                <span>鼠标移动</span><b>瞄准</b>
                <span>左键 / 空格</span><b>射击</b>
                <span>Shift / 右键</span><b>滑行</b>
                <span>中央信标</span><b>每秒回血 20</b>
              </div>
            </section>

            {/* 本地测试诊断面板（仅开发环境） */}
            {SHOW_LOCAL_TEST_TOOLS ? (
              <section className="panel">
                <div className="section-head compact">
                  <div><p>LIVE TEST</p><h2>实时测试</h2></div>
                  <Activity aria-hidden="true" />
                </div>
                <div className="diagnostic-grid">
                  <Diagnostic icon={<Crosshair aria-hidden="true" />} label="坐标" value={`${agent.x.toFixed(1)}, ${agent.y.toFixed(1)}`} />
                  <Diagnostic icon={<Target aria-hidden="true" />} label="朝向" value={`${Math.round((agent.angle * 180) / Math.PI)}°`} />
                  <Diagnostic icon={<Users aria-hidden="true" />} label="在线" value={String(presencePlayers.length)} />
                  <Diagnostic icon={<Zap aria-hidden="true" />} label="按键" value={pressedKeys.join(" ").toUpperCase() || "等待输入"} />
                </div>
              </section>
            ) : null}

            {/* 事件日志 */}
            <section className="panel">
              <div className="section-head compact">
                <div><p>EVENTS</p><h2>日志</h2></div>
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
      )}
    </main>
  );
}

// ===========================================================================
// 子组件 — 大厅等待界面
// ===========================================================================

/**
 * 房间等待大厅。
 * 显示房间信息和在线玩家列表，房主可点击开始。
 */
function RoomLobby({
  roomCode, localPlayerId, hostId, players, canStart, isHost, onStart,
}: {
  roomCode: string;
  localPlayerId: string;
  hostId: string;
  players: PresencePlayer[];
  canStart: boolean;
  isHost: boolean;
  onStart: () => void;
}) {
  return (
    <section className="room-lobby">
      <section className="panel lobby-main">
        <div className="section-head">
          <div>
            <p>ROOM {roomCode}</p>
            <h2>等待行动开始</h2>
          </div>
          <span className={canStart ? "ready-pill ready" : "ready-pill"}>
            {players.length}/4 在线
          </span>
        </div>

        <div className="lobby-info-grid">
          <div><span>房主</span><b>{formatShortId(hostId)}</b></div>
          <div><span>你的 ID</span><b>{formatShortId(localPlayerId)}</b></div>
          <div><span>开始条件</span><b>{canStart ? "已满足" : "至少 2 人"}</b></div>
        </div>

        <button
          className="primary-button full-button"
          type="button"
          disabled={!isHost || !canStart}
          onClick={onStart}
        >
          <Play aria-hidden="true" />
          {isHost ? "开始行动" : "等待房主开始"}
        </button>
      </section>

      <section className="panel lobby-roster-panel">
        <div className="section-head compact">
          <div><p>PLAYERS</p><h2>房间玩家</h2></div>
          <Users aria-hidden="true" />
        </div>
        <PlayerRoster players={players} localPlayerId={localPlayerId} hostId={hostId} />
      </section>
    </section>
  );
}

// ===========================================================================
// 子组件 — 玩家状态 HUD
// ===========================================================================

/**
 * 玩家状态抬头显示器。
 * 显示生命/能量/占领进度条、击杀/死亡、射击消耗、当前技能等。
 */
function PlayerHud({
  agent, weaponLevel, fireCost, dashCost, captureProgress, guardUntil, hasteUntil,
}: {
  agent: ArenaAgent;
  weaponLevel: number;
  fireCost: number;
  dashCost: number;
  captureProgress: number;
  guardUntil: number;
  hasteUntil: number;
}) {
  const profile = getCharacterProfile(agent.color);
  const now = Date.now();
  const activeSkills = [guardUntil > now ? "护盾" : "", hasteUntil > now ? "疾行" : ""].filter(Boolean);

  return (
    <div className="player-hud">
      {/* 身份标识 */}
      <div className="hud-identity">
        <i style={{ "--player-color": agent.color } as CSSProperties} />
        <div>
          <strong>{agent.name}</strong>
          <span>{profile.name} / {profile.traitTitle}</span>
        </div>
      </div>

      {/* 进度条：生命 / 能量 / 占领 */}
      <HudMeter label="生命" value={agent.hp} max={profile.stats.maxHp} tone="red" />
      <HudMeter label="共用能量" value={agent.energy} max={100} tone={agent.energy >= Math.min(fireCost, dashCost) ? "green" : "amber"} />
      <HudMeter label="核心上传" value={captureProgress} max={100} tone="amber" />

      {/* 属性网格 */}
      <div className="hud-cost-grid">
        <span>击杀 <b>{agent.kills}/{KILL_LIMIT}</b></span>
        <span>死亡 <b>{agent.deaths}</b></span>
        <span>射击消耗 <b>{Math.ceil(fireCost)}</b></span>
        <span>滑行消耗 <b>{Math.ceil(dashCost)}</b></span>
        <span>弹道数量 <b>{1 + profile.stats.extraProjectiles + weaponLevel}</b></span>
        <span>技能 <b>{activeSkills.join(" / ") || "无"}</b></span>
      </div>
    </div>
  );
}

/** 进度条组件 */
function HudMeter({ label, value, max, tone }: { label: string; value: number; max: number; tone: "green" | "amber" | "red" }) {
  return (
    <div className={`hud-meter ${tone}`}>
      <div><span>{label}</span><b>{Math.round(value)}</b></div>
      <i><em style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} /></i>
    </div>
  );
}

// ===========================================================================
// 子组件 — 房间信息
// ===========================================================================

/** 房间信息摘要 */
function RoomSummary({
  roomCode, startedAt, hostId, players, localPlayerId,
}: {
  roomCode: string;
  startedAt: number | null;
  hostId: string;
  players: PresencePlayer[];
  localPlayerId: string;
}) {
  return (
    <div className="room-summary">
      <div className="room-summary-grid">
        <span>房间码 <b>{roomCode}</b></span>
        <span>开始 <b>{startedAt ? formatClock(startedAt) : "等待"}</b></span>
      </div>
      <PlayerRoster players={players} localPlayerId={localPlayerId} hostId={hostId} compact />
    </div>
  );
}

// ===========================================================================
// 子组件 — 击杀榜
// ===========================================================================

/**
 * 击杀排行榜。
 * 按击杀数降序排列，显示每个玩家的击杀/死亡数据。
 */
function KillBoard({ agents, winnerId }: { agents: ArenaAgent[]; winnerId: string | null }) {
  const sortedAgents = [...agents].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.joinedAt - b.joinedAt);

  return (
    <div className="kill-board">
      {sortedAgents.map((agent) => {
        const profile = getCharacterProfile(agent.color);
        return (
          <div key={agent.id} className={winnerId === agent.id ? "winner" : ""}>
            <i style={{ "--player-color": agent.color } as CSSProperties} />
            <span>{agent.name}<small>{profile.name}</small></span>
            <b>{agent.kills}</b>
            <em>{agent.deaths}</em>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// 子组件 — 玩家列表
// ===========================================================================

/**
 * 玩家列表组件。
 * 支持详细模式（大厅）和紧凑模式（战场侧栏）。
 */
function PlayerRoster({
  players, localPlayerId, hostId, compact = false,
}: {
  players: PresencePlayer[];
  localPlayerId: string;
  hostId: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "arena-player-list compact" : "arena-player-list detailed"}>
      {players.map((player) => {
        const profile = getCharacterProfile(player.color);
        return (
          <div key={player.id} className={player.id === localPlayerId ? "current" : ""}>
            <i style={{ "--player-color": player.color } as CSSProperties} />
            <span>
              {player.name}
              <small>{formatShortId(player.id)} {player.id === hostId ? "房主" : "队员"}</small>
            </span>
            <b>{profile.name}</b>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// 子组件 — 训练靶机 & 角色精灵 & 诊断信息
// ===========================================================================

/** 创建训练靶机（开发环境专用） */
function createTrainingTarget(now: number) {
  return createArenaAgent(
    {
      id: "training-target",
      name: "训练靶机",
      color: "#f26d5b",
      codename: "靶机",
      joinedAt: now,
    },
    now,
    1
  );
}

/**
 * 角色精灵组件。
 * 渲染战场上的角色圆形标记，包含代号、特性、HP、朝向指示线。
 * 支持多种视觉状态：本地高亮、Overdrive 放大、受击闪烁、死亡半透明等。
 */
function AgentSprite({ agent, isLocal, isFlashing }: { agent: ArenaAgent; isLocal: boolean; isFlashing: boolean }) {
  const profile = getCharacterProfile(agent.color);
  return (
    <div
      className={`agent-sprite ${isLocal ? "local" : ""} ${agent.isOverdrive ? "overdrive" : ""} ${
        agent.action === "hit" ? "hit" : ""
      } ${agent.action === "heal" ? "heal" : ""} ${isFlashing ? "flashing" : ""} ${agent.hp <= 0 ? "down" : ""}`}
      style={{
        "--x": `${agent.x}%`,
        "--y": `${agent.y}%`,
        "--agent-color": agent.color,
        "--angle": `${agent.angle}rad`,
        "--size": `${AGENT_RADIUS * 2 * (agent.isOverdrive ? OVERDRIVE_RADIUS_MULTIPLIER : 1)}%`,
      } as CSSProperties}
    >
      <span>{agent.codename}</span>
      <em>{profile.traitTitle}</em>
      <i />
      <b>{Math.round(agent.hp)}</b>
    </div>
  );
}

/** 本地测试仪表组件 */
function Meter({ label, value, tone }: { label: string; value: number; tone: "green" | "amber" | "red" }) {
  return (
    <div className={`test-meter ${tone}`}>
      <div><span>{label}</span><b>{Math.round(value)}</b></div>
      <i><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>
    </div>
  );
}

/** 诊断数据项组件（开发环境实时调试面板） */
function Diagnostic({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="diagnostic">
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

// =============================================================================
// 工具函数
// =============================================================================

/** 生成 4 位随机房间码（排除易混淆字符 I/O/0/1） */
function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** 标准化房间码：转大写 → 去除非字母数字 → 截断到 4 位 */
function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

/** 标准化数组索引（循环取模，处理负数） */
function normalizeIndex(value: number, length: number) {
  if (!Number.isFinite(value) || length <= 0) return 0;
  return ((Math.trunc(value) % length) + length) % length;
}

/** 格式化短 ID 显示：截取前 4 位 + ... + 后 4 位 */
function formatShortId(value: string) {
  return value.length > 8 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}

/** 从 URL hash 解析房间码 */
function getRoomFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  return normalizeRoomCode(params.get("room") ?? "");
}

/** 生成客户端唯一 ID（优先使用 crypto.randomUUID） */
function createClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 标准化键盘输入。
 * 只接受游戏相关按键：WASD、E、空格、Shift、方向键
 */
function normalizeKey(key: string) {
  const normalized = key.toLowerCase();
  if (["w", "a", "s", "d", "e", " ", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(normalized)) {
    return normalized === " " ? "space" : normalized;
  }
  return "";
}

/** 格式化连接状态为中文 */
function formatConnection(status: string) {
  if (status === "connected")      return "已连接";
  if (status === "connecting")     return "连接中";
  if (status === "missing-config") return "本地";
  if (status === "error")          return "异常";
  return "待连接";
}

/** 格式化 Unix 时间戳为 HH:MM:SS */
function formatClock(time: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(time));
}
