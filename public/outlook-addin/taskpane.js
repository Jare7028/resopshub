/* global Office */
(function () {
  "use strict";

  const PREVIEW_ENDPOINT = "/api/integrations/outlook/tasks/import/preview";
  const CREATE_ENDPOINT = "/api/integrations/outlook/tasks/import/create";

  const state = {
    previewPayload: null,
    previewResponse: null,
  };

  const views = {
    idle: document.getElementById("state-idle"),
    loading: document.getElementById("state-loading"),
    signedOut: document.getElementById("state-signed-out"),
    error: document.getElementById("state-error"),
    form: document.getElementById("state-form"),
    success: document.getElementById("state-success"),
  };

  const startButton = document.getElementById("start-import-button");
  const retryButton = document.getElementById("retry-button");
  const signedInRetryButton = document.getElementById("signed-in-retry-button");
  const createTaskButton = document.getElementById("create-task-button");
  const reloadPreviewButton = document.getElementById("reload-preview-button");
  const importAnotherButton = document.getElementById("import-another-button");

  const loginLink = document.getElementById("login-link");
  const loadingText = document.getElementById("loading-text");
  const errorText = document.getElementById("error-text");
  const formStatus = document.getElementById("form-status");
  const openTaskLink = document.getElementById("open-task-link");

  const duplicateWarning = document.getElementById("duplicate-warning");
  const duplicateList = document.getElementById("duplicate-list");
  const duplicateConfirm = document.getElementById("duplicate-confirm");

  const titleInput = document.getElementById("task-title");
  const notesInput = document.getElementById("task-notes");
  const assigneeUserIdInput = document.getElementById("task-assignee-id");
  const clientIdInput = document.getElementById("task-client-id");
  const projectIdInput = document.getElementById("task-project-id");
  const dueDateInput = document.getElementById("task-due-date");
  const dueTimeInput = document.getElementById("task-due-time");

  function showView(key) {
    Object.keys(views).forEach((name) => {
      const element = views[name];
      if (!element) return;
      if (name === key) {
        element.classList.remove("is-hidden");
      } else {
        element.classList.add("is-hidden");
      }
    });
  }

  function setLoadingMessage(text) {
    if (loadingText) {
      loadingText.textContent = text;
    }
  }

  function setFormStatus(text, isError) {
    if (!formStatus) return;
    formStatus.textContent = text || "";
    formStatus.style.color = isError ? "#b91c1c" : "#334155";
  }

  function setError(text) {
    if (errorText) {
      errorText.textContent = text || "Something went wrong.";
    }
    showView("error");
  }

  function updateLoginLink() {
    if (!loginLink) return;
    const returnTo = `${window.location.pathname}${window.location.search}`;
    loginLink.href = `/login?return_to=${encodeURIComponent(returnTo)}`;
  }

  function recoverEmailLineBreaks(text) {
    return String(text || "")
      .replace(/([.!?])(?=[A-Z][a-z])/g, "$1\n")
      .replace(/((?:many )?thanks),([A-Z][a-z]+)/gi, "$1,\n$2")
      .replace(/\s+(From:\s)/g, "\n\n$1")
      .replace(/\s+(Sent:\s)/g, "\n$1")
      .replace(/\s+(To:\s)/g, "\n$1")
      .replace(/\s+(Cc:\s)/g, "\n$1")
      .replace(/\s+(Subject:\s)/g, "\n$1")
      .replace(/\s+(Date:\s)/g, "\n$1");
  }

  function normalizeBodyText(raw) {
    return recoverEmailLineBreaks(
      String(raw || "")
        .replace(/\r\n/g, "\n")
        .replace(/\u00A0/g, " ")
    )
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extractTextFromHtml(html) {
    const parser = document.createElement("div");
    const htmlWithBreaks = String(html || "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(
        /<\s*\/\s*(p|div|li|tr|table|blockquote|h1|h2|h3|h4|h5|h6|section|article)\s*>/gi,
        "</$1>\n"
      );
    parser.innerHTML = htmlWithBreaks;
    const junkNodes = parser.querySelectorAll("script, style, noscript");
    Array.prototype.forEach.call(junkNodes, (node) => node.remove());
    return parser.textContent || parser.innerText || "";
  }

  function getMessageBody(item, coercionType) {
    return new Promise((resolve, reject) => {
      item.body.getAsync(coercionType, (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          resolve(String(result.value || ""));
          return;
        }
        reject(new Error(result.error && result.error.message ? result.error.message : "Could not read message body."));
      });
    });
  }

  function getCurrentItem() {
    const mailbox = Office.context.mailbox;
    if (!mailbox || !mailbox.item) {
      throw new Error("No active Outlook message was found.");
    }
    return mailbox.item;
  }

  async function getCurrentMessageBodyText(item) {
    const htmlCoercionType =
      Office &&
      Office.CoercionType &&
      typeof Office.CoercionType.Html !== "undefined"
        ? Office.CoercionType.Html
        : null;

    if (htmlCoercionType !== null) {
      try {
        const htmlBody = await getMessageBody(item, htmlCoercionType);
        const htmlText = normalizeBodyText(extractTextFromHtml(htmlBody));
        if (htmlText) {
          return htmlText;
        }
      } catch (_htmlError) {
        // Fall back to plain text when HTML retrieval is unavailable in this client.
      }
    }

    const plainTextBody = await getMessageBody(item, Office.CoercionType.Text);
    return normalizeBodyText(plainTextBody);
  }

  function normalizeParticipant(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    const emailAddress = value.emailAddress || value.address || null;
    const displayName = value.displayName || value.name || null;
    return emailAddress || displayName || null;
  }

  function normalizeParticipantList(values) {
    if (!Array.isArray(values)) return [];
    return values.map(normalizeParticipant).filter(Boolean);
  }

  function normalizeAttachmentType(value) {
    const normalized = String(value || "").trim();
    return normalized || null;
  }

  function collectCurrentMessageAttachments(item) {
    if (!item || !Array.isArray(item.attachments)) return [];
    return item.attachments
      .filter((attachment) => attachment && attachment.name)
      .map((attachment) => ({
        name: String(attachment.name),
        size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : null,
        contentType: normalizeAttachmentType(attachment.attachmentType),
        webLink: null,
      }));
  }

  async function collectCurrentMessagePayload() {
    const mailbox = Office.context.mailbox;
    const item = getCurrentItem();
    const bodyText = await getCurrentMessageBodyText(item);
    const mailboxEmail = mailbox.userProfile && mailbox.userProfile.emailAddress
      ? mailbox.userProfile.emailAddress
      : "";

    if (!mailboxEmail) {
      throw new Error("Could not determine mailbox email address.");
    }

    let restMessageId = item.itemId;
    if (mailbox.convertToRestId && Office.MailboxEnums && Office.MailboxEnums.RestVersion) {
      try {
        restMessageId = mailbox.convertToRestId(
          item.itemId,
          Office.MailboxEnums.RestVersion.v2_0
        );
      } catch (_error) {
        restMessageId = item.itemId;
      }
    }

    const conversationId = item.conversationId ? String(item.conversationId) : null;
    const fromValue = normalizeParticipant(item.from || item.sender || null);
    const toValues = normalizeParticipantList(item.to);
    const ccValues = normalizeParticipantList(item.cc);
    const sentAtValue = item.dateTimeCreated ? String(item.dateTimeCreated) : null;
    const attachments = collectCurrentMessageAttachments(item);

    return {
      selectedMessageId: String(restMessageId),
      internetMessageId: null,
      conversationId: conversationId,
      subject: String(item.subject || ""),
      mailbox: {
        userEmail: mailboxEmail,
        mailboxType: "primary",
      },
      thread: [
        {
          messageId: String(restMessageId),
          internetMessageId: null,
          from: fromValue,
          to: toValues,
          cc: ccValues,
          sentAt: sentAtValue,
          subject: String(item.subject || ""),
          bodyText: bodyText || "(No text body)",
          attachments: attachments,
          webLink: null,
        },
      ],
    };
  }

  async function callPreview(payload) {
    const response = await fetch(PREVIEW_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function callCreate(payload) {
    const response = await fetch(CREATE_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function renderDuplicateWarning(matches) {
    if (!duplicateWarning || !duplicateList || !duplicateConfirm) return;
    duplicateList.innerHTML = "";
    duplicateConfirm.checked = false;
    if (!Array.isArray(matches) || !matches.length) {
      duplicateWarning.classList.add("is-hidden");
      return;
    }

    matches.forEach((match) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `${window.location.origin}${match.href}`;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = `${match.title || "Task"} (${match.createdAt || "unknown date"})`;
      li.appendChild(a);
      duplicateList.appendChild(li);
    });

    duplicateWarning.classList.remove("is-hidden");
  }

  function renderPreview(payload, previewResponse) {
    state.previewPayload = payload;
    state.previewResponse = previewResponse;
    if (titleInput) {
      titleInput.value = previewResponse.normalizedTitle || "";
    }
    if (notesInput) {
      notesInput.value = previewResponse.normalizedNotesText || previewResponse.normalizedTaskContentText || "";
    }
    if (clientIdInput) {
      clientIdInput.value = "";
    }
    if (assigneeUserIdInput) {
      assigneeUserIdInput.value = "";
    }
    if (projectIdInput) {
      projectIdInput.value = "";
    }
    if (dueDateInput) {
      dueDateInput.value = "";
    }
    if (dueTimeInput) {
      dueTimeInput.value = "";
    }
    renderDuplicateWarning(previewResponse.duplicateMatches || []);
    const warningText = Array.isArray(previewResponse.warnings) ? previewResponse.warnings.join(" ") : "";
    setFormStatus(warningText, false);
    showView("form");
  }

  async function loadPreview() {
    setLoadingMessage("Reading current email...");
    setFormStatus("", false);
    showView("loading");

    try {
      const payload = await collectCurrentMessagePayload();
      setLoadingMessage("Preparing task preview...");
      const { response, data } = await callPreview(payload);
      if (response.status === 401) {
        showView("signedOut");
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || "Preview request failed.");
      }
      renderPreview(payload, data);
    } catch (error) {
      const message = error && error.message ? error.message : "Failed to load import preview.";
      setError(message);
    }
  }

  async function createTaskFromPreview() {
    if (!state.previewPayload || !state.previewResponse) {
      setFormStatus("Load a preview first.", true);
      return;
    }
    if (!titleInput || !notesInput) {
      setFormStatus("Required form controls are unavailable.", true);
      return;
    }

    const payload = {
      previewPayload: state.previewPayload,
      title: titleInput.value.trim(),
      assigneeUserId:
        assigneeUserIdInput && assigneeUserIdInput.value.trim()
          ? assigneeUserIdInput.value.trim()
          : "",
      clientId: clientIdInput && clientIdInput.value.trim() ? clientIdInput.value.trim() : null,
      projectId: projectIdInput && projectIdInput.value.trim() ? projectIdInput.value.trim() : null,
      dueDate: dueDateInput && dueDateInput.value ? dueDateInput.value : null,
      dueTime: dueTimeInput && dueTimeInput.value ? dueTimeInput.value : null,
      notesText: notesInput.value,
      createDespiteDuplicate: Boolean(duplicateConfirm && duplicateConfirm.checked),
    };

    setFormStatus("Creating task...", false);
    const { response, data } = await callCreate(payload);
    if (response.status === 401) {
      showView("signedOut");
      return;
    }
    if (response.status === 409) {
      renderDuplicateWarning(data.duplicateMatches || []);
      setFormStatus(data.error || "Duplicate warning confirmation is required.", true);
      return;
    }
    if (!response.ok) {
      setFormStatus(data.error || "Task creation failed.", true);
      return;
    }

    if (openTaskLink) {
      openTaskLink.href = `${window.location.origin}${data.taskHref}`;
    }
    showView("success");
  }

  function bindEvents() {
    if (startButton) {
      startButton.addEventListener("click", loadPreview);
    }
    if (retryButton) {
      retryButton.addEventListener("click", loadPreview);
    }
    if (signedInRetryButton) {
      signedInRetryButton.addEventListener("click", loadPreview);
    }
    if (reloadPreviewButton) {
      reloadPreviewButton.addEventListener("click", loadPreview);
    }
    if (createTaskButton) {
      createTaskButton.addEventListener("click", createTaskFromPreview);
    }
    if (importAnotherButton) {
      importAnotherButton.addEventListener("click", () => {
        showView("idle");
      });
    }
  }

  Office.onReady((info) => {
    if (!info || !Office.context || !Office.context.mailbox) {
      setError("Outlook mailbox context is unavailable.");
      return;
    }
    updateLoginLink();
    bindEvents();
    showView("idle");
  });
})();
