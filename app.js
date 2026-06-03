const config = window.KNOWLEDGE_VAULT_CONFIG || {};
const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey);
let api = null;

const state = {
  session: null,
  items: [],
  selectedId: null,
  search: "",
  category: "",
  authMode: "signin",
};

const els = {
  sessionStatus: document.querySelector("#sessionStatus"),
  authPanel: document.querySelector("#authPanel"),
  authTitle: document.querySelector("#authTitle"),
  authSubtitle: document.querySelector("#authSubtitle"),
  authSwitch: document.querySelector("#authSwitch"),
  signinModeButton: document.querySelector("#signinModeButton"),
  signupModeButton: document.querySelector("#signupModeButton"),
  authForm: document.querySelector("#authForm"),
  emailInput: document.querySelector("#emailInput"),
  passwordInput: document.querySelector("#passwordInput"),
  passwordToggleButton: document.querySelector("#passwordToggleButton"),
  authMessage: document.querySelector("#authMessage"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  signedInPanel: document.querySelector("#signedInPanel"),
  userEmail: document.querySelector("#userEmail"),
  signoutButton: document.querySelector("#signoutButton"),
  setupWarning: document.querySelector("#setupWarning"),
  workspace: document.querySelector("#workspace"),
  searchInput: document.querySelector("#searchInput"),
  categoryFilter: document.querySelector("#categoryFilter"),
  newItemButton: document.querySelector("#newItemButton"),
  itemList: document.querySelector("#itemList"),
  detailPanel: document.querySelector("#detailPanel"),
  itemDialog: document.querySelector("#itemDialog"),
  itemForm: document.querySelector("#itemForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
  cancelButton: document.querySelector("#cancelButton"),
  itemIdInput: document.querySelector("#itemIdInput"),
  titleInput: document.querySelector("#titleInput"),
  categoryInput: document.querySelector("#categoryInput"),
  tagsInput: document.querySelector("#tagsInput"),
  sourceUrlInput: document.querySelector("#sourceUrlInput"),
  contentInput: document.querySelector("#contentInput"),
  toast: document.querySelector("#toast"),
};

init();

async function init() {
  bindEvents();

  if (!hasSupabaseConfig) {
    els.setupWarning.hidden = false;
    els.authForm.querySelectorAll("input, button").forEach((el) => {
      el.disabled = true;
    });
    els.authSwitch.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    showToast("请先填写 Supabase 配置。");
    renderSignedOut();
    return;
  }

  api = createSupabaseApi(config.supabaseUrl, config.supabaseAnonKey);
  state.session = await api.getSession();
  renderAuth();

  if (state.session) {
    await loadItems();
  }
}

function bindEvents() {
  els.authForm.addEventListener("submit", handleAuthSubmit);
  els.signinModeButton.addEventListener("click", () => setAuthMode("signin"));
  els.signupModeButton.addEventListener("click", () => setAuthMode("signup"));
  els.passwordToggleButton.addEventListener("click", togglePasswordVisibility);
  els.signoutButton.addEventListener("click", handleSignOut);
  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value.trim().toLowerCase();
    renderItems();
  });
  els.categoryFilter.addEventListener("change", () => {
    state.category = els.categoryFilter.value;
    renderItems();
  });
  els.newItemButton.addEventListener("click", () => openItemDialog());
  els.itemForm.addEventListener("submit", handleSaveItem);
  els.closeDialogButton.addEventListener("click", closeDialog);
  els.cancelButton.addEventListener("click", closeDialog);
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  if (!els.authForm.reportValidity()) {
    return;
  }

  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;

  setAuthBusy(true);
  setAuthMessage("");

  try {
    const session = state.authMode === "signup" ? await api.signUp(email, password) : await api.signIn(email, password);
    if (session) {
      state.session = session;
      state.selectedId = null;
      renderAuth();
      await loadItems();
    }
  } catch (error) {
    setAuthBusy(false);
    setAuthMessage(toFriendlyAuthError(error.message), "error");
    return;
  }

  els.passwordInput.value = "";
  setAuthBusy(false);

  if (state.authMode === "signup") {
    setAuthMessage("注册已提交。如果邮箱收到确认邮件，请先完成验证。", "success");
    showToast("注册已提交。");
    return;
  }

  setAuthMessage("登录成功。", "success");
  showToast("登录成功。");
}

async function handleSignOut() {
  try {
    await api.signOut();
  } catch (error) {
    showToast(error.message);
    return;
  }
  state.session = null;
  state.items = [];
  state.selectedId = null;
  renderAuth();
  renderItems();
  renderDetail(null);
  showToast("已退出登录。");
}

async function loadItems() {
  try {
    state.items = await api.listItems(state.session.access_token);
  } catch (error) {
    showToast(error.message);
    return;
  }

  renderCategoryOptions();
  renderItems();
  renderDetail(state.items.find((item) => item.id === state.selectedId) || null);
}

async function handleSaveItem(event) {
  event.preventDefault();
  const id = els.itemIdInput.value;
  const payload = {
    title: els.titleInput.value.trim(),
    category: els.categoryInput.value.trim(),
    content: els.contentInput.value.trim(),
    tags: parseTags(els.tagsInput.value),
    source_url: els.sourceUrlInput.value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (!payload.title || !payload.category || !payload.content) {
    showToast("请填写标题、分类和内容。");
    return;
  }

  try {
    const savedItem = id
      ? await api.updateItem(state.session.access_token, id, payload)
      : await api.createItem(state.session.access_token, { ...payload, user_id: state.session.user.id });
    state.selectedId = savedItem?.id || id;
  } catch (error) {
    showToast(error.message);
    return;
  }

  closeDialog();
  await loadItems();
  showToast("保存成功。");
}

async function deleteItem(id) {
  const shouldDelete = window.confirm("确定删除这条资料吗？删除后无法恢复。");
  if (!shouldDelete) return;

  try {
    await api.deleteItem(state.session.access_token, id);
  } catch (error) {
    showToast(error.message);
    return;
  }

  state.selectedId = null;
  await loadItems();
  showToast("已删除。");
}

function renderAuth() {
  if (state.session) {
    els.sessionStatus.textContent = "已登录";
    els.authTitle.textContent = "账号状态";
    els.authSubtitle.textContent = "已经连接到你的云端资料库。";
    els.authSwitch.hidden = true;
    els.authForm.hidden = true;
    els.signedInPanel.hidden = false;
    els.userEmail.textContent = state.session.user.email;
    els.workspace.hidden = false;
    return;
  }

  renderSignedOut();
}

function renderSignedOut() {
  els.sessionStatus.textContent = hasSupabaseConfig ? "未登录" : "未连接";
  els.authSwitch.hidden = false;
  els.authForm.hidden = false;
  els.signedInPanel.hidden = true;
  els.workspace.hidden = true;
  renderAuthMode();
}

function setAuthMode(mode) {
  state.authMode = mode;
  setAuthMessage("");
  renderAuthMode();
  els.passwordInput.autocomplete = mode === "signup" ? "new-password" : "current-password";
  els.passwordInput.focus();
}

function renderAuthMode() {
  const isSignup = state.authMode === "signup";
  els.authTitle.textContent = isSignup ? "创建账号" : "登录资料库";
  els.authSubtitle.textContent = isSignup ? "用邮箱创建账号后即可保存资料。" : "进入后可以管理自己的资料。";
  els.authSubmitButton.textContent = isSignup ? "创建账号" : "登录";
  els.signinModeButton.setAttribute("aria-pressed", String(!isSignup));
  els.signupModeButton.setAttribute("aria-pressed", String(isSignup));
}

function togglePasswordVisibility() {
  const shouldShow = els.passwordInput.type === "password";
  els.passwordInput.type = shouldShow ? "text" : "password";
  els.passwordToggleButton.textContent = shouldShow ? "隐藏" : "显示";
  els.passwordInput.focus();
}

function setAuthMessage(message, type = "info") {
  els.authMessage.textContent = message;
  els.authMessage.dataset.type = type;
  els.authMessage.hidden = !message;
}

function renderCategoryOptions() {
  const categories = [...new Set(state.items.map((item) => item.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );

  els.categoryFilter.innerHTML = `<option value="">全部分类</option>`;
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.categoryFilter.append(option);
  }
  els.categoryFilter.value = state.category;
}

function renderItems() {
  const items = getFilteredItems();
  els.itemList.innerHTML = "";

  if (!items.length) {
    els.itemList.innerHTML = `
      <div class="empty-state">
        <h2>没有匹配资料</h2>
        <p>调整搜索条件，或新增一条资料。</p>
      </div>
    `;
    return;
  }

  for (const item of items) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `item-card${item.id === state.selectedId ? " active" : ""}`;
    card.innerHTML = `
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta-row">
        <span class="chip">${escapeHtml(item.category || "未分类")}</span>
        <span class="chip">${formatDate(item.updated_at || item.created_at)}</span>
      </div>
      <p>${escapeHtml(item.content || "")}</p>
      ${renderTags(item.tags)}
    `;
    card.addEventListener("click", () => {
      state.selectedId = item.id;
      renderItems();
      renderDetail(item);
    });
    els.itemList.append(card);
  }
}

function renderDetail(item) {
  if (!item) {
    els.detailPanel.innerHTML = `
      <div class="empty-state">
        <h2>选择一条资料</h2>
        <p>左侧会显示你保存的资料。点击卡片可以查看详情、编辑或删除。</p>
      </div>
    `;
    return;
  }

  els.detailPanel.innerHTML = `
    <div class="detail-body">
      <div>
        <h2>${escapeHtml(item.title)}</h2>
        <div class="meta-row">
          <span class="chip">${escapeHtml(item.category || "未分类")}</span>
          <span class="chip">更新于 ${formatDate(item.updated_at || item.created_at)}</span>
        </div>
      </div>
      ${renderTags(item.tags)}
      <div class="detail-content">${escapeHtml(item.content || "")}</div>
      ${item.source_url ? `<a class="source-link" href="${escapeAttribute(item.source_url)}" target="_blank" rel="noreferrer">打开来源链接</a>` : ""}
      <div class="button-row">
        <button type="button" class="primary-button" id="editItemButton">编辑</button>
        <button type="button" class="secondary-button" id="deleteItemButton">删除</button>
      </div>
    </div>
  `;

  document.querySelector("#editItemButton").addEventListener("click", () => openItemDialog(item));
  document.querySelector("#deleteItemButton").addEventListener("click", () => deleteItem(item.id));
}

function openItemDialog(item = null) {
  els.dialogTitle.textContent = item ? "编辑资料" : "新增资料";
  els.itemIdInput.value = item?.id || "";
  els.titleInput.value = item?.title || "";
  els.categoryInput.value = item?.category || "";
  els.tagsInput.value = Array.isArray(item?.tags) ? item.tags.join(", ") : "";
  els.sourceUrlInput.value = item?.source_url || "";
  els.contentInput.value = item?.content || "";
  els.itemDialog.showModal();
  els.titleInput.focus();
}

function closeDialog() {
  els.itemDialog.close();
  els.itemForm.reset();
}

function getFilteredItems() {
  return state.items.filter((item) => {
    const tags = Array.isArray(item.tags) ? item.tags.join(" ") : "";
    const searchable = `${item.title} ${item.category} ${item.content} ${tags}`.toLowerCase();
    const matchesSearch = !state.search || searchable.includes(state.search);
    const matchesCategory = !state.category || item.category === state.category;
    return matchesSearch && matchesCategory;
  });
}

function parseTags(value) {
  return value
    .split(/[，,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function renderTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return `<div class="tag-row">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function setAuthBusy(isBusy) {
  els.authSubmitButton.disabled = isBusy;
  els.signinModeButton.disabled = isBusy;
  els.signupModeButton.disabled = isBusy;
  els.authSubmitButton.textContent = isBusy ? "处理中..." : state.authMode === "signup" ? "创建账号" : "登录";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 3200);
}

function formatDate(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function createSupabaseApi(supabaseUrl, anonKey) {
  const baseUrl = supabaseUrl.replace(/\/$/, "");
  const storageKey = `knowledge-vault-session:${baseUrl}`;

  return {
    async getSession() {
      const session = readSession(storageKey);
      if (!session) return null;
      if (!isSessionExpiring(session)) return session;

      try {
        return await this.refreshSession(session.refresh_token);
      } catch (_error) {
        clearSession(storageKey);
        return null;
      }
    },

    async signUp(email, password) {
      const data = await requestJson(`${baseUrl}/auth/v1/signup`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password }),
      });
      const session = normalizeSession(data);
      if (session) saveSession(storageKey, session);
      return session;
    },

    async signIn(email, password) {
      const data = await requestJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password }),
      });
      const session = normalizeSession(data);
      if (!session) {
        throw new Error("登录失败，请稍后再试。");
      }
      saveSession(storageKey, session);
      return session;
    },

    async refreshSession(refreshToken) {
      const data = await requestJson(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const session = normalizeSession(data);
      if (!session) {
        throw new Error("登录状态已过期，请重新登录。");
      }
      saveSession(storageKey, session);
      return session;
    },

    async signOut() {
      const session = readSession(storageKey);
      if (session?.access_token) {
        await requestJson(`${baseUrl}/auth/v1/logout`, {
          method: "POST",
          headers: authHeaders(session.access_token),
        });
      }
      clearSession(storageKey);
    },

    async listItems(accessToken) {
      return requestJson(
        `${baseUrl}/rest/v1/items?select=id,user_id,title,category,content,tags,source_url,created_at,updated_at&order=updated_at.desc`,
        {
          headers: authHeaders(accessToken),
        }
      );
    },

    async createItem(accessToken, payload) {
      const data = await requestJson(`${baseUrl}/rest/v1/items?select=id`, {
        method: "POST",
        headers: {
          ...authHeaders(accessToken),
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      });
      return data?.[0] || null;
    },

    async updateItem(accessToken, id, payload) {
      const data = await requestJson(`${baseUrl}/rest/v1/items?id=eq.${encodeURIComponent(id)}&select=id`, {
        method: "PATCH",
        headers: {
          ...authHeaders(accessToken),
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      });
      return data?.[0] || null;
    },

    async deleteItem(accessToken, id) {
      await requestJson(`${baseUrl}/rest/v1/items?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(accessToken),
      });
    },
  };

  function authHeaders(accessToken = anonKey) {
    return {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.msg || data?.message || data?.error_description || data?.hint || `请求失败：${response.status}`);
  }

  return data;
}

function normalizeSession(data) {
  if (!data?.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || readJwtPayload(data.access_token)?.exp,
    user: {
      id: data.user?.id || readJwtPayload(data.access_token)?.sub,
      email: data.user?.email || readJwtPayload(data.access_token)?.email,
    },
  };
}

function readSession(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey));
  } catch (_error) {
    return null;
  }
}

function saveSession(storageKey, session) {
  localStorage.setItem(storageKey, JSON.stringify(session));
}

function clearSession(storageKey) {
  localStorage.removeItem(storageKey);
}

function isSessionExpiring(session) {
  if (!session.expires_at) return false;
  return session.expires_at * 1000 - Date.now() < 60 * 1000;
}

function readJwtPayload(token) {
  try {
    const payload = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const json = decodeURIComponent(
      atob(payload)
        .split("")
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("")
    );
    return JSON.parse(json);
  } catch (_error) {
    return null;
  }
}

function toFriendlyAuthError(message) {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) {
    return "邮箱或密码不正确。";
  }
  if (lower.includes("email not confirmed")) {
    return "邮箱还没有完成验证，请先打开确认邮件。";
  }
  if (lower.includes("password")) {
    return "密码至少需要 6 位。";
  }
  if (lower.includes("already registered") || lower.includes("user already registered")) {
    return "这个邮箱已经注册过，请切回登录。";
  }
  return message;
}
