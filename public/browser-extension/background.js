const MENU_ID = "resopshub_add_task";
const CAPTURE_ENDPOINT = "/api/integrations/browser/tasks/capture";
const DEFAULT_BASE_URL = "https://resopshub-p1pi.vercel.app";
const DEFAULT_SETTINGS = {
  baseUrl: DEFAULT_BASE_URL,
  openTaskAfterCreate: true,
};

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Add Task",
      contexts: ["selection"],
    });
  });
}

function normalizeBaseUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function getStorageValues(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (values) => resolve(values || {}));
  });
}

async function getSettings() {
  const values = await getStorageValues(Object.keys(DEFAULT_SETTINGS));
  return {
    baseUrl: String(values.baseUrl || DEFAULT_SETTINGS.baseUrl),
    openTaskAfterCreate:
      typeof values.openTaskAfterCreate === "boolean"
        ? values.openTaskAfterCreate
        : DEFAULT_SETTINGS.openTaskAfterCreate,
  };
}

function truncateText(text, maxLength) {
  const normalized = String(text || "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildTaskTitleFromSelection(selectedText) {
  const firstLine = String(selectedText || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return "Captured task";
  }
  return truncateText(firstLine, 240);
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon-128.png",
    title,
    message: truncateText(message, 220) || "Done.",
  });
}

function openOptionsPage() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
}

async function createTask(baseUrl, payload) {
  const response = await fetch(`${baseUrl}${CAPTURE_ENDPOINT}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      typeof data.error === "string" ? data.error : `Request failed (${response.status}).`
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
  getStorageValues(["baseUrl", "openTaskAfterCreate"]).then((values) => {
    const updates = {};
    if (!normalizeBaseUrl(values.baseUrl)) {
      updates.baseUrl = DEFAULT_SETTINGS.baseUrl;
    }
    if (typeof values.openTaskAfterCreate !== "boolean") {
      updates.openTaskAfterCreate = DEFAULT_SETTINGS.openTaskAfterCreate;
    }
    if (Object.keys(updates).length) {
      chrome.storage.sync.set(updates);
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const selectedText = String(info.selectionText || "").trim();
  if (!selectedText) {
    showNotification("ResOpsHub Add Task", "No text is selected.");
    return;
  }

  const settings = await getSettings();
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!baseUrl) {
    showNotification("ResOpsHub Add Task", "Set your ResOpsHub URL in extension settings.");
    openOptionsPage();
    return;
  }

  const payload = {
    selectedText,
    title: buildTaskTitleFromSelection(selectedText),
    sourceUrl: info.pageUrl || (tab && tab.url) || null,
    sourceTitle: (tab && tab.title) || null,
  };

  try {
    const data = await createTask(baseUrl, payload);
    const taskHref = typeof data.taskHref === "string" ? data.taskHref : "";
    const taskUrl = taskHref ? `${baseUrl}${taskHref}` : `${baseUrl}/tasks`;
    if (settings.openTaskAfterCreate) {
      chrome.tabs.create({ url: taskUrl });
    }
    showNotification("Task created", payload.title);
  } catch (error) {
    const status = Number(error && error.status ? error.status : 0);
    if (status === 401) {
      const loginUrl = `${baseUrl}/login?return_to=${encodeURIComponent("/tasks?tab=add")}`;
      chrome.tabs.create({ url: loginUrl });
      showNotification("Sign-in required", "Sign in to ResOpsHub, then try Add Task again.");
      return;
    }

    const message =
      error && error.message ? error.message : "Task creation failed. Check extension settings.";
    showNotification("ResOpsHub Add Task", message);
  }
});
