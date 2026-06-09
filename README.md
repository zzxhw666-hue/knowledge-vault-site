# 情报暗战

一个 2-4 人实时角色对抗网页游戏原型。玩家用昵称和房间码加入同一局，用键盘移动角色、鼠标瞄准行动，并在右侧实时测试面板查看生命、能量、坐标、朝向、核心上传进度和房间状态。

## 操控

```text
WASD / 方向键：移动
鼠标移动：瞄准
左键 / 空格：脉冲射击
Shift / 右键：冲刺
E + 站在中央信标范围内：上传核心得分
```

房间内会有一个训练靶机，方便单人测试射击和移动手感。

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
