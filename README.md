# 个人资料库网站

这是一个零构建、免费托管优先的查询资料库网站。用户登录后可以新增、查询、筛选、编辑、删除自己的资料。

## 1. 本地预览

在这个文件夹里启动一个本地服务器：

```bash
python3 -m http.server 5173
```

然后打开：

```text
http://localhost:5173
```

第一次打开会提示还没有连接 Supabase，这是正常的。

## 2. 创建 Supabase 后端

1. 打开 Supabase，新建一个项目。
2. 进入项目的 SQL Editor。
3. 复制 `supabase-schema.sql` 的全部内容并运行。
4. 进入 Authentication，确认 Email 登录已启用。
5. 进入 Project Settings，找到 API：
   - 复制 Project URL
   - 复制 anon public key

不要复制或填写 `service_role` key。`service_role` 是后端密钥，不能放在网页代码里。

## 3. 填写前端配置

打开 `supabase-config.js`，填入你的项目地址和公开 anon key：

```js
window.KNOWLEDGE_VAULT_CONFIG = {
  supabaseUrl: "https://你的项目.supabase.co",
  supabaseAnonKey: "你的 anon public key",
};
```

保存后刷新网页。

## 4. 使用网站

1. 输入邮箱和密码，点击注册。
2. 如果 Supabase 要求邮箱验证，去邮箱里点击确认链接。
3. 回到网站登录。
4. 新增资料、搜索资料、按分类筛选、编辑和删除。

## 5. 发布到 GitHub Pages

1. 在 GitHub 新建一个公开仓库。
2. 把本文件夹里的文件推送到仓库。
3. 打开仓库 Settings -> Pages。
4. Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/root`。
6. 保存后等待 GitHub 生成网址。

网址通常长这样：

```text
https://你的用户名.github.io/仓库名/
```

## 6. 设置 Supabase 回跳地址

上线后，回到 Supabase：

1. 进入 Authentication -> URL Configuration。
2. Site URL 填你的 GitHub Pages 网址。
3. Redirect URLs 也加入你的 GitHub Pages 网址。

## 7. 权限规则

数据库已开启 Row Level Security：

- 未登录用户不能读取资料。
- 登录用户只能读取自己的资料。
- 登录用户只能新增、编辑、删除自己的资料。
- 前端只使用 Supabase anon public key。
