# 情报暗战

一个 2-4 人实时对抗网页游戏原型。玩家用昵称和房间码加入同一局，在情报地图上实时投入资源争夺据点，触发随机事件，最终抢占核心节点获胜。

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

当前原型使用 public channel，房间频道格式为 `game:<roomCode>`。

## 脚本

```bash
npm run dev
npm test
npm run build
npm run preview
```

## GitHub Pages

项目的 Vite base 已配置为 `/knowledge-vault-site/`。构建后会把可直接发布的文件放到 `docs/`：

```text
docs/index.html
docs/supabase-config.js
docs/assets/
```

在 GitHub 仓库里进入 `Settings -> Pages`，选择：

```text
Source: Deploy from a branch
Branch: main
Folder: /docs
```

保存后等待 1-3 分钟，访问：

```text
https://zzxhw666-hue.github.io/knowledge-vault-site/
```

## 原型边界

- 不做账号登录、排行榜、长期战绩和匹配系统。
- 不做服务端裁判或强防作弊，房主客户端负责权威结算。
- 房间状态是实时临时状态，不写入数据库。
