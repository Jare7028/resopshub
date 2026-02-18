import { extractPlainText } from "./tiptapText";

export const OUTLOOK_IMPORT_MAX_THREAD_MESSAGES = 100;
export const OUTLOOK_IMPORT_MAX_ATTACHMENTS = 100;
export const OUTLOOK_IMPORT_MAX_TEXT_BYTES = 1024 * 1024;
export const OUTLOOK_IMPORT_DEFAULT_TITLE = "Email follow-up";
export const OUTLOOK_IMPORT_MAX_TITLE_LENGTH = 240;

type TiptapTextNode = {
  type: "text";
  text: string;
};

type TiptapNode = {
  type: string;
  content?: Array<TiptapNode | TiptapTextNode>;
};

type TiptapDoc = {
  type: "doc";
  content: TiptapNode[];
};

export type OutlookImportAttachment = {
  name: string;
  size?: number | null;
  contentType?: string | null;
  webLink?: string | null;
};

export type OutlookImportThreadMessage = {
  messageId: string;
  internetMessageId?: string | null;
  from?: string | null;
  to?: string[] | null;
  cc?: string[] | null;
  sentAt?: string | null;
  subject?: string | null;
  bodyText: string;
  bodyHtml?: string | null;
  attachments?: OutlookImportAttachment[];
  webLink?: string | null;
};

export type OutlookImportPreviewRequest = {
  selectedMessageId: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
  subject: string;
  mailbox: {
    userEmail: string;
    mailboxType: "primary";
  };
  thread: OutlookImportThreadMessage[];
};

export type OutlookDuplicateMatch = {
  taskId: string;
  title: string;
  href: string;
  createdAt: string;
};

export type OutlookImportPreviewResponse = {
  normalizedTitle: string;
  normalizedTaskContent: unknown;
  normalizedTaskContentText: string;
  normalizedNotesText: string;
  duplicateMatches: OutlookDuplicateMatch[];
  warnings: string[];
};

export type OutlookImportCreateRequest = {
  previewPayload: OutlookImportPreviewRequest;
  title: string;
  assigneeUserId: string;
  clientId?: string | null;
  projectId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  notesText?: string | null;
  createDespiteDuplicate: boolean;
};

export type OutlookImportCreateResponse = {
  taskId: string;
  taskHref: string;
  duplicateWarningShown: boolean;
};

type ParsedOutlookImportCreateRequest = {
  previewPayload: OutlookImportPreviewRequest;
  title: string;
  assigneeUserId: string | null;
  clientId: string | null;
  projectId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  notesText: string | null;
  createDespiteDuplicate: boolean;
};

export type PreparedOutlookImportPreview = {
  payload: OutlookImportPreviewRequest;
  normalizedTitle: string;
  normalizedTaskContent: TiptapDoc;
  normalizedTaskContentText: string;
  normalizedNotesText: string;
  warnings: string[];
  attachmentCount: number;
  normalizedTextBytes: number;
};

type DuplicateCandidateRow = {
  task_id?: string | null;
  created_at?: string | null;
  tasks?:
    | {
        id?: string | null;
        title?: string | null;
        created_at?: string | null;
      }
    | Array<{
        id?: string | null;
        title?: string | null;
        created_at?: string | null;
      }>
    | null;
};

export class OutlookImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutlookImportValidationError";
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toNormalizedString(value: unknown, limit = 4000) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit);
}

function normalizeOptionalString(value: unknown, limit = 4000) {
  const normalized = toNormalizedString(value, limit);
  return normalized || null;
}

function normalizeStringArray(value: unknown, fieldLabel: string) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  const normalized = value
    .map((item) => toNormalizedString(item, 320))
    .filter(Boolean);
  if (normalized.length > OUTLOOK_IMPORT_MAX_ATTACHMENTS) {
    throw new OutlookImportValidationError(`${fieldLabel} has too many values.`);
  }
  return normalized;
}

function assertDate(value: string | null, fieldLabel: string) {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OutlookImportValidationError(`${fieldLabel} must use YYYY-MM-DD format.`);
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) {
    throw new OutlookImportValidationError(`${fieldLabel} is not a valid date.`);
  }
}

function normalizeDueTime(value: string | null) {
  if (!value) return null;
  const raw = value.trim();
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) {
    throw new OutlookImportValidationError("Due time must use HH:mm or HH:mm:ss format.");
  }
  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

function toIsoDate(value: unknown) {
  const normalized = normalizeOptionalString(value, 80);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function paragraph(text?: string) {
  const normalized = text?.trim() || "";
  if (!normalized) {
    return { type: "paragraph" } satisfies TiptapNode;
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text: normalized }],
  } satisfies TiptapNode;
}

export function buildTiptapDocFromPlainText(rawText: string) {
  const lines = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const content = (lines.length ? lines : [""]).map((line) =>
    paragraph(line.replace(/\s+$/g, ""))
  );
  return {
    type: "doc",
    content,
  } satisfies TiptapDoc;
}

function bulletList(items: string[]) {
  const normalized = items.map((item) => item.trim()).filter(Boolean);
  if (!normalized.length) return null;
  return {
    type: "bulletList",
    content: normalized.map((item) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
    })),
  } satisfies TiptapNode;
}

function normalizeAttachment(
  value: unknown,
  warningCollector: string[]
): OutlookImportAttachment {
  if (!isObjectRecord(value)) {
    throw new OutlookImportValidationError("Attachment entries must be objects.");
  }

  const name = toNormalizedString(value.name, 512);
  if (!name) {
    throw new OutlookImportValidationError("Attachment name is required.");
  }

  let size: number | null = null;
  if (value.size !== null && typeof value.size !== "undefined") {
    const numeric = Number(value.size);
    if (!Number.isFinite(numeric) || numeric < 0) {
      warningCollector.push(`Attachment "${name}" has an invalid size; size was ignored.`);
    } else {
      size = Math.floor(numeric);
    }
  }

  const contentType = normalizeOptionalString(value.contentType, 200);
  const webLink = normalizeOptionalString(value.webLink, 2048);

  return { name, size, contentType, webLink };
}

function normalizeThreadMessage(
  value: unknown,
  index: number,
  warningCollector: string[]
): OutlookImportThreadMessage {
  if (!isObjectRecord(value)) {
    throw new OutlookImportValidationError(`Thread message ${index + 1} must be an object.`);
  }

  const messageId = toNormalizedString(value.messageId, 2048);
  if (!messageId) {
    throw new OutlookImportValidationError(`Thread message ${index + 1} is missing messageId.`);
  }

  const bodyText = String(value.bodyText || "").replace(/\r\n/g, "\n").trim();

  const attachmentsRaw = Array.isArray(value.attachments) ? value.attachments : [];
  const attachments = attachmentsRaw.map((attachment) =>
    normalizeAttachment(attachment, warningCollector)
  );

  return {
    messageId,
    internetMessageId: normalizeOptionalString(value.internetMessageId, 2048),
    from: normalizeOptionalString(value.from, 320),
    to: normalizeStringArray(value.to, `Thread message ${index + 1} to`),
    cc: normalizeStringArray(value.cc, `Thread message ${index + 1} cc`),
    sentAt: toIsoDate(value.sentAt),
    subject: normalizeOptionalString(value.subject, 1000),
    bodyText,
    bodyHtml: normalizeOptionalString(value.bodyHtml, 100000),
    attachments,
    webLink: normalizeOptionalString(value.webLink, 2048),
  };
}

function normalizeMailbox(value: unknown) {
  if (!isObjectRecord(value)) {
    throw new OutlookImportValidationError("mailbox is required.");
  }

  const userEmail = toNormalizedString(value.userEmail, 320).toLowerCase();
  if (!userEmail || !userEmail.includes("@")) {
    throw new OutlookImportValidationError("mailbox.userEmail must be a valid email address.");
  }

  const mailboxType = String(value.mailboxType || "").trim().toLowerCase();
  if (mailboxType !== "primary") {
    throw new OutlookImportValidationError(
      "Only primary mailbox imports are supported in v1."
    );
  }

  return {
    userEmail,
    mailboxType: "primary" as const,
  };
}

export function normalizeOutlookImportTitle(rawSubject: unknown) {
  const normalized = toNormalizedString(rawSubject, OUTLOOK_IMPORT_MAX_TITLE_LENGTH);
  return normalized || OUTLOOK_IMPORT_DEFAULT_TITLE;
}

export function normalizeOutlookImportPreviewRequest(
  input: unknown
): { payload: OutlookImportPreviewRequest; warnings: string[] } {
  if (!isObjectRecord(input)) {
    throw new OutlookImportValidationError("Request body must be a JSON object.");
  }

  const warnings: string[] = [];

  const selectedMessageId = toNormalizedString(input.selectedMessageId, 2048);
  if (!selectedMessageId) {
    throw new OutlookImportValidationError("selectedMessageId is required.");
  }

  const subject = toNormalizedString(input.subject, 1000);
  const mailbox = normalizeMailbox(input.mailbox);

  if (!Array.isArray(input.thread)) {
    throw new OutlookImportValidationError("thread must be an array of messages.");
  }

  if (!input.thread.length) {
    throw new OutlookImportValidationError(
      "Thread snapshot is required. Expand the conversation in Outlook and try again."
    );
  }

  if (input.thread.length > OUTLOOK_IMPORT_MAX_THREAD_MESSAGES) {
    throw new OutlookImportValidationError(
      `Thread has too many messages. Maximum is ${OUTLOOK_IMPORT_MAX_THREAD_MESSAGES}.`
    );
  }

  const thread = input.thread.map((message, index) =>
    normalizeThreadMessage(message, index, warnings)
  );

  const attachmentCount = countOutlookImportAttachments(thread);
  if (attachmentCount > OUTLOOK_IMPORT_MAX_ATTACHMENTS) {
    throw new OutlookImportValidationError(
      `Thread has too many attachment entries. Maximum is ${OUTLOOK_IMPORT_MAX_ATTACHMENTS}.`
    );
  }

  return {
    payload: {
      selectedMessageId,
      internetMessageId: normalizeOptionalString(input.internetMessageId, 2048),
      conversationId: normalizeOptionalString(input.conversationId, 2048),
      subject,
      mailbox,
      thread,
    },
    warnings,
  };
}

function buildOutlookImportSummaryLines(payload: OutlookImportPreviewRequest, importedAtIso: string) {
  return [
    `Subject: ${normalizeOutlookImportTitle(payload.subject)}`,
    `Imported at: ${importedAtIso}`,
    `Mailbox: ${payload.mailbox.userEmail}`,
  ];
}

function buildOutlookImportMessageHeaderLines(message: OutlookImportThreadMessage) {
  const lines = [
    message.from ? `From: ${message.from}` : null,
    message.to?.length ? `To: ${message.to.join(", ")}` : null,
    message.cc?.length ? `Cc: ${message.cc.join(", ")}` : null,
    message.sentAt ? `Sent: ${message.sentAt}` : null,
    message.subject ? `Subject: ${message.subject}` : null,
  ].filter(Boolean);
  return lines as string[];
}

function buildOutlookImportBodyLines(bodyText: string) {
  const normalized = String(bodyText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!normalized) {
    return ["(No text body)"];
  }
  return normalized.split("\n").map((line) => line.replace(/\s+$/g, ""));
}

export function buildOutlookImportReadableNotesText(args: {
  payload: OutlookImportPreviewRequest;
  importedAtIso: string;
}) {
  const { payload, importedAtIso } = args;
  const lines: string[] = [];

  lines.push("Source: Outlook email import");
  lines.push("");
  lines.push("Summary");
  buildOutlookImportSummaryLines(payload, importedAtIso).forEach((line) => {
    lines.push(`- ${line}`);
  });
  lines.push("");

  payload.thread.forEach((message, index) => {
    lines.push(`Message ${index + 1}`);
    buildOutlookImportMessageHeaderLines(message).forEach((line) => {
      lines.push(line);
    });
    lines.push("");
    lines.push("Body:");
    buildOutlookImportBodyLines(message.bodyText).forEach((line) => {
      lines.push(line);
    });

    if (message.webLink) {
      lines.push("");
      lines.push(`Message link: ${message.webLink}`);
    }

    if (index < payload.thread.length - 1) {
      lines.push("");
      lines.push("----");
      lines.push("");
    } else {
      lines.push("");
    }
  });

  const firstLink = payload.thread.find((message) => message.webLink)?.webLink || null;
  if (firstLink) {
    lines.push("Outlook thread link:");
    lines.push(firstLink);
  }

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

export function buildOutlookImportTaskContent(args: {
  payload: OutlookImportPreviewRequest;
  importedAtIso: string;
}) {
  const { payload, importedAtIso } = args;
  const nodes: TiptapNode[] = [];
  nodes.push(paragraph("Source: Outlook email import"));
  nodes.push(paragraph());
  nodes.push(paragraph("Summary"));
  const summaryList = bulletList(buildOutlookImportSummaryLines(payload, importedAtIso));
  if (summaryList) {
    nodes.push(summaryList);
  }
  nodes.push(paragraph());

  payload.thread.forEach((message, index) => {
    nodes.push(paragraph(`Message ${index + 1}`));
    buildOutlookImportMessageHeaderLines(message).forEach((line) => {
      nodes.push(paragraph(line));
    });
    nodes.push(paragraph());
    nodes.push(paragraph("Body:"));
    buildOutlookImportBodyLines(message.bodyText).forEach((line) => {
      nodes.push(paragraph(line));
    });

    if (message.webLink) {
      nodes.push(paragraph());
      nodes.push(paragraph(`Message link: ${message.webLink}`));
    }

    if (index < payload.thread.length - 1) {
      nodes.push(paragraph());
      nodes.push(paragraph("----"));
      nodes.push(paragraph());
    } else {
      nodes.push(paragraph());
    }
  });

  const firstLink = payload.thread.find((message) => message.webLink)?.webLink || null;
  if (firstLink) {
    nodes.push(paragraph("Outlook thread link:"));
    nodes.push(paragraph(firstLink));
  }

  return {
    type: "doc",
    content: nodes,
  } satisfies TiptapDoc;
}

export function countOutlookImportAttachments(thread: OutlookImportThreadMessage[]) {
  return thread.reduce((sum, message) => sum + (message.attachments?.length || 0), 0);
}

export function prepareOutlookImportPreview(
  input: unknown,
  options?: { importedAtIso?: string }
): PreparedOutlookImportPreview {
  const { payload, warnings } = normalizeOutlookImportPreviewRequest(input);
  const importedAtIso = options?.importedAtIso || new Date().toISOString();
  const normalizedTitle = normalizeOutlookImportTitle(payload.subject);
  const normalizedTaskContent = buildOutlookImportTaskContent({
    payload,
    importedAtIso,
  });
  const normalizedTaskContentText = extractPlainText(normalizedTaskContent);
  const normalizedNotesText = buildOutlookImportReadableNotesText({
    payload,
    importedAtIso,
  });
  const normalizedTextBytes = new TextEncoder().encode(normalizedNotesText).length;
  if (normalizedTextBytes > OUTLOOK_IMPORT_MAX_TEXT_BYTES) {
    throw new OutlookImportValidationError(
      `Thread text is too large. Maximum is ${OUTLOOK_IMPORT_MAX_TEXT_BYTES} bytes.`
    );
  }

  return {
    payload,
    normalizedTitle,
    normalizedTaskContent,
    normalizedTaskContentText,
    normalizedNotesText,
    warnings,
    attachmentCount: countOutlookImportAttachments(payload.thread),
    normalizedTextBytes,
  };
}

export function parseOutlookImportCreateRequest(input: unknown): ParsedOutlookImportCreateRequest {
  if (!isObjectRecord(input)) {
    throw new OutlookImportValidationError("Request body must be a JSON object.");
  }

  const previewPayload = input.previewPayload;
  if (!previewPayload) {
    throw new OutlookImportValidationError("previewPayload is required.");
  }

  const normalizedTitle = normalizeOutlookImportTitle(input.title);
  const assigneeUserId = normalizeOptionalString(input.assigneeUserId, 120);
  const clientId = normalizeOptionalString(input.clientId, 120);
  const projectId = normalizeOptionalString(input.projectId, 120);
  const dueDate = normalizeOptionalString(input.dueDate, 20);
  const dueTime = normalizeDueTime(normalizeOptionalString(input.dueTime, 20));
  const rawNotesText =
    typeof input.notesText === "string"
      ? input.notesText.replace(/\r\n/g, "\n").trim()
      : "";
  const notesText = rawNotesText || null;
  assertDate(dueDate, "dueDate");
  if (dueTime && !dueDate) {
    throw new OutlookImportValidationError("dueDate is required when dueTime is provided.");
  }
  if (notesText) {
    const bytes = new TextEncoder().encode(notesText).length;
    if (bytes > OUTLOOK_IMPORT_MAX_TEXT_BYTES) {
      throw new OutlookImportValidationError(
        `notesText is too large. Maximum is ${OUTLOOK_IMPORT_MAX_TEXT_BYTES} bytes.`
      );
    }
  }

  return {
    previewPayload: normalizeOutlookImportPreviewRequest(previewPayload).payload,
    title: normalizedTitle,
    assigneeUserId,
    clientId,
    projectId,
    dueDate,
    dueTime,
    notesText,
    createDespiteDuplicate: Boolean(input.createDespiteDuplicate),
  };
}

export function mapOutlookImportDuplicateMatches(rows: DuplicateCandidateRow[]) {
  const byTask = new Map<string, OutlookDuplicateMatch>();

  for (const row of rows || []) {
    const relatedTask = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;
    const taskId = String(relatedTask?.id || row.task_id || "").trim();
    if (!taskId) continue;

    const createdAt = String(relatedTask?.created_at || row.created_at || "").trim();
    const candidate: OutlookDuplicateMatch = {
      taskId,
      title: String(relatedTask?.title || "Untitled task"),
      href: `/tasks/${taskId}`,
      createdAt: createdAt || new Date(0).toISOString(),
    };

    const existing = byTask.get(taskId);
    if (!existing || existing.createdAt < candidate.createdAt) {
      byTask.set(taskId, candidate);
    }
  }

  return Array.from(byTask.values()).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
}

export function buildOutlookImportSourceMetadata(args: {
  payload: OutlookImportPreviewRequest;
  importedAtIso: string;
}) {
  const { payload, importedAtIso } = args;
  return {
    provider: "outlook",
    imported_at: importedAtIso,
    subject: payload.subject,
    mailbox: payload.mailbox,
    selected_message_id: payload.selectedMessageId,
    internet_message_id: payload.internetMessageId || null,
    conversation_id: payload.conversationId || null,
    thread: payload.thread.map((message) => ({
      message_id: message.messageId,
      internet_message_id: message.internetMessageId || null,
      from: message.from || null,
      to: message.to || [],
      cc: message.cc || [],
      sent_at: message.sentAt || null,
      subject: message.subject || null,
      web_link: message.webLink || null,
      attachments: (message.attachments || []).map((attachment) => ({
        name: attachment.name,
        size: typeof attachment.size === "number" ? attachment.size : null,
        content_type: attachment.contentType || null,
        web_link: attachment.webLink || null,
      })),
    })),
  };
}
