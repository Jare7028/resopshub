const DEFAULT_SETTINGS = {
  baseUrl: "",
  openTaskAfterCreate: true,
};

function normalizeBaseUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "";
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function showStatus(text, isError) {
  const status = document.getElementById("status");
  if (!status) return;
  status.textContent = text || "";
  status.style.color = isError ? "#b91c1c" : "#0f172a";
}

function loadSettings() {
  chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (values) => {
    const baseUrlInput = document.getElementById("base-url");
    const openTaskCheckbox = document.getElementById("open-task-after-create");
    if (baseUrlInput) {
      baseUrlInput.value = String(values.baseUrl || DEFAULT_SETTINGS.baseUrl);
    }
    if (openTaskCheckbox) {
      openTaskCheckbox.checked =
        typeof values.openTaskAfterCreate === "boolean"
          ? values.openTaskAfterCreate
          : DEFAULT_SETTINGS.openTaskAfterCreate;
    }
  });
}

function saveSettings(event) {
  event.preventDefault();
  showStatus("", false);

  const baseUrlInput = document.getElementById("base-url");
  const openTaskCheckbox = document.getElementById("open-task-after-create");
  const normalizedBaseUrl = normalizeBaseUrl(baseUrlInput ? baseUrlInput.value : "");
  if (!normalizedBaseUrl) {
    showStatus("Enter a valid http(s) URL.", true);
    return;
  }

  chrome.storage.sync.set(
    {
      baseUrl: normalizedBaseUrl,
      openTaskAfterCreate: Boolean(openTaskCheckbox && openTaskCheckbox.checked),
    },
    () => {
      showStatus("Settings saved.", false);
    }
  );
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  const form = document.getElementById("settings-form");
  if (form) {
    form.addEventListener("submit", saveSettings);
  }
});

