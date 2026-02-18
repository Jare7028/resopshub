/* global Office, OfficeRuntime */
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

  function normalizeBodyText(raw) {
    const text = String(raw || "");
    const stripped = text.indexOf("<") !== -1 ? stripHtml(text) : text;
    return stripped
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stripHtml(html) {
    const parser = document.createElement("div");
    parser.innerHTML = html;
    return parser.textContent || parser.innerText || "";
  }

  function getCurrentItem() {
    const mailbox = Office.context.mailbox;
    if (!mailbox || !mailbox.item) {
      throw new Error("No active Outlook message was found.");
    }
    return mailbox.item;
  }

  function getCurrentMessageBodyText(item) {
    return new Promise((resolve, reject) => {
      item.body.getAsync(Office.CoercionType.Text, (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          resolve(normalizeBodyText(result.value));
          return;
        }
        reject(new Error(result.error && result.error.message ? result.error.message : "Could not read message body."));
      });
    });
  }

  async function getGraphAccessToken() {
    if (
      typeof OfficeRuntime === "undefined" ||
      !OfficeRuntime.auth ||
      !OfficeRuntime.auth.getAccessToken
    ) {
      throw new Error("Graph access is unavailable in this Outlook client.");
    }
    return OfficeRuntime.auth.getAccessToken({
      allowSignInPrompt: true,
      allowConsentPrompt: true,
      forMSGraphAccess: true,
    });
  }

  async function graphRequest(token, path) {
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph request failed: ${response.status} ${errorText}`);
    }
    return response.json();
  }

  function toRecipientAddress(recipient) {
    if (!recipient || !recipient.emailAddress) return null;
    return recipient.emailAddress.address || recipient.emailAddress.name || null;
  }

  function toRecipientList(input) {
    if (!Array.isArray(input)) return [];
    return input.map(toRecipientAddress).filter(Boolean);
  }

  async function fetchMessageAttachments(token, messageId, messageWebLink) {
    const encodedId = encodeURIComponent(messageId);
    try {
      const data = await graphRequest(
        token,
        `/me/messages/${encodedId}/attachments?$select=name,size,contentType`
      );
      const rows = Array.isArray(data.value) ? data.value : [];
      return rows
        .filter((row) => row && row.name)
        .map((row) => ({
          name: String(row.name),
          size: Number.isFinite(Number(row.size)) ? Number(row.size) : null,
          contentType: row.contentType ? String(row.contentType) : null,
          webLink: messageWebLink || null,
        }));
    } catch (_error) {
      return [];
    }
  }

  async function collectConversationThreadPayload() {
    const mailbox = Office.context.mailbox;
    const item = getCurrentItem();
    const fallbackBodyText = await getCurrentMessageBodyText(item);
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

    setLoadingMessage("Fetching conversation from Microsoft Graph...");
    const graphToken = await getGraphAccessToken();
    const selectedMessage = await graphRequest(
      graphToken,
      `/me/messages/${encodeURIComponent(restMessageId)}?$select=id,internetMessageId,conversationId,subject,webLink,from,toRecipients,ccRecipients,receivedDateTime,body`
    );
    const conversationId = selectedMessage.conversationId || item.conversationId;
    if (!conversationId) {
      throw new Error(
        "Conversation ID is missing. Full-thread import requires a conversation-enabled message."
      );
    }

    const escapedConversationId = String(conversationId).replace(/'/g, "''");
    const conversationFilter = encodeURIComponent(
      `conversationId eq '${escapedConversationId}'`
    );
    const conversationData = await graphRequest(
      graphToken,
      `/me/messages?$top=100&$orderby=receivedDateTime%20asc&$filter=${conversationFilter}&$select=id,internetMessageId,conversationId,subject,webLink,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments`
    );
    const messages = Array.isArray(conversationData.value) ? conversationData.value : [];

    if (!messages.length) {
      throw new Error(
        "Conversation expansion failed. Open this email in a full Outlook client and retry."
      );
    }

    const thread = [];
    for (const message of messages) {
      const messageId = message && message.id ? String(message.id) : "";
      if (!messageId) continue;
      const messageWebLink = message.webLink ? String(message.webLink) : null;
      const attachments = message.hasAttachments
        ? await fetchMessageAttachments(graphToken, messageId, messageWebLink)
        : [];
      thread.push({
        messageId,
        internetMessageId: message.internetMessageId ? String(message.internetMessageId) : null,
        from: toRecipientAddress(message.from),
        to: toRecipientList(message.toRecipients),
        cc: toRecipientList(message.ccRecipients),
        sentAt: message.receivedDateTime ? String(message.receivedDateTime) : null,
        subject: message.subject ? String(message.subject) : null,
        bodyText: normalizeBodyText(message.body && message.body.content ? message.body.content : ""),
        attachments,
        webLink: messageWebLink,
      });
    }

    if (!thread.length) {
      throw new Error(
        "Conversation expansion failed because no thread messages were returned."
      );
    }

    return {
      selectedMessageId: selectedMessage.id ? String(selectedMessage.id) : String(restMessageId),
      internetMessageId: selectedMessage.internetMessageId
        ? String(selectedMessage.internetMessageId)
        : null,
      conversationId: String(conversationId),
      subject: selectedMessage.subject ? String(selectedMessage.subject) : String(item.subject || ""),
      mailbox: {
        userEmail: mailboxEmail,
        mailboxType: "primary",
      },
      thread: thread.map((message) => ({
        messageId: message.messageId,
        internetMessageId: message.internetMessageId || null,
        from: message.from || null,
        to: message.to || [],
        cc: message.cc || [],
        sentAt: message.sentAt || null,
        subject: message.subject || null,
        bodyText: message.bodyText || fallbackBodyText || "(No text body)",
        attachments: message.attachments || [],
        webLink: message.webLink || null,
      })),
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
      notesInput.value = previewResponse.normalizedTaskContentText || "";
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
    setLoadingMessage("Collecting Outlook message context...");
    setFormStatus("", false);
    showView("loading");

    try {
      const payload = await collectConversationThreadPayload();
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
