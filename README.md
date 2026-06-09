# 情报暗战

一个 2-4 人实时角色对抗网页游戏原型。玩家用昵称和房间码加入同一局，用键盘移动角色、鼠标瞄准行动，在情报暗战地图里争夺中央信标。

## 操控

```text
WASD / 方向键：移动
鼠标移动：瞄准
左键 / 空格：脉冲射击
Shift / 右键：滑行
E + 站在中央信标范围内：上传核心得分
```

公开网页默认只显示正式游戏界面和房间信息；右侧实时测试面板、按键诊断、训练靶机和重置测试按钮只会在本地 `npm run dev` 开发模式出现，方便自己调试射击和移动手感。

## 战斗规则

- 玩家进入房间后先进入大厅，能看到房间码、房主、玩家短 ID、昵称和所选角色；至少 2 人在线后房主可以开始。
- 角色颜色对应不同角色特性，选择页面会显示角色名、特性名和效果说明。
- 射击和滑行共用同一条能量；能量不足时需要等待恢复。
- `Shift` / 右键会触发平滑滑行并留下可见轨迹，不再是瞬间位移。
- 角色被命中时会出现受击动作、命中特效、屏幕震动和短暂伤害闪光。
- 脉冲射击是可见弹道，子弹会沿鼠标朝向飞行；拾取弹道升级后，每次射击会额外增加 1 枚子弹。
- 地图每 10 秒生成一个弹道升级物，角色碰到后自动拾取，最高可叠加多次。
- 站在中央信标范围内会按基础每秒 20 点生命恢复，并显示回血特效。
- 地图中的中继和掩体是实体障碍，角色不能直接穿过。
- 子弹不能穿过中继和掩体，命中障碍或边界后会反弹一次，随后继续飞行或消散。
- 中央信标仍然用于上传核心得分，站在范围内按 `E` 推进胜利进度。

## 本地运行

```bash
npm install
npm run dev
```

打开终端提示的本地地址，通常是：

```text
http://localhost:5280/knowledge-vault-site/
```

## Supabase Realtime 配置

游戏只使用 Supabase Realtime Broadcast 和 Presence，不需要创建数据库表。

编辑 `public/supabase-config.js`：

```js
window.KNOWLEDGE_VAULT_CONFIG = {
  supabaseUrl: "https://你的项目.supabase.co",
  supabaseAnonKey: "你的 publishable 或 anon public key",
};
```

当前原型使用 public channel，房间频道格式为 `arena:<roomCode>`。

## 脚本

```bash
npm run dev
npm test
npm run build
npm run preview
```

## GitHub Pages

项目的 Vite base 已配置为 `/knowledge-vault-site/`。构建后会把可直接发布的文件同步到仓库根目录和 `docs/`：

```text
index.html
supabase-config.js
assets/

docs/index.html
docs/supabase-config.js
docs/assets/
```

在 GitHub 仓库里进入 `Settings -> Pages`，选择根目录或 `docs` 都可以。推荐：

```text
Source: Deploy from a branch
Branch: main
Folder: /root
```

保存后等待 1-3 分钟，访问：

```text
https://zzxhw666-hue.github.io/knowledge-vault-site/
```

## 原型边界

- 不做账号登录、排行榜、长期战绩和匹配系统。
- 不做服务端裁判或强防作弊，角色位置和动作由客户端实时广播。
- 房间状态是实时临时状态，不写入数据库。
