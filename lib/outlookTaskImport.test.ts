import { describe, expect, it } from "vitest";
import {
  OutlookImportValidationError,
  OUTLOOK_IMPORT_MAX_ATTACHMENTS,
  OUTLOOK_IMPORT_MAX_THREAD_MESSAGES,
  type OutlookImportPreviewRequest,
  buildOutlookImportTaskContent,
  mapOutlookImportDuplicateMatches,
  parseOutlookImportCreateRequest,
  prepareOutlookImportPreview,
} from "./outlookTaskImport";
import { extractPlainText } from "./tiptapText";

function buildPreviewPayload(): OutlookImportPreviewRequest {
  return {
    selectedMessageId: "selected-message-id-1",
    internetMessageId: "<internet-id@contoso.com>",
    conversationId: "conversation-1",
    subject: "  Follow up with client   ",
    mailbox: {
      userEmail: "owner@example.com",
      mailboxType: "primary",
    },
    thread: [
      {
        messageId: "message-1",
        internetMessageId: "<msg1@contoso.com>",
        from: "alice@contoso.com",
        to: ["owner@example.com"],
        cc: ["team@example.com"],
        sentAt: "2026-02-18T09:00:00.000Z",
        subject: "Client update",
        bodyText: "Can we review this by Friday?",
        attachments: [
          {
            name: "proposal.pdf",
            size: 1200,
            contentType: "application/pdf",
            webLink: "https://outlook.office.com/mail/id/proposal",
          },
        ],
        webLink: "https://outlook.office.com/mail/id/message-1",
      },
    ],
  };
}

describe("outlookTaskImport", () => {
  it("normalizes title from subject for preview", () => {
    const prepared = prepareOutlookImportPreview(buildPreviewPayload(), {
      importedAtIso: "2026-02-18T12:00:00.000Z",
    });
    expect(prepared.normalizedTitle).toBe("Follow up with client");
  });

  it("builds readable multiline notes text for preview editing", () => {
    const prepared = prepareOutlookImportPreview(buildPreviewPayload(), {
      importedAtIso: "2026-02-18T12:00:00.000Z",
    });
    expect(prepared.normalizedNotesText).toContain("Source: Outlook email import");
    expect(prepared.normalizedNotesText).toContain("Summary\n- Subject: Follow up with client");
    expect(prepared.normalizedNotesText).toContain("\n\nMessage 1\nFrom: alice@contoso.com");
    expect(prepared.normalizedNotesText).toContain("\nBody:\nCan we review this by Friday?");
    expect(prepared.normalizedNotesText).not.toContain("Selected message ID:");
    expect(prepared.normalizedNotesText).not.toContain("Conversation ID:");
    expect(prepared.normalizedNotesText).not.toContain("Thread message count:");
    expect(prepared.normalizedNotesText).not.toContain("Attachments:");
    expect(prepared.normalizedNotesText).toContain("Outlook thread link:");
  });

  it("converts thread content into searchable tiptap text", () => {
    const payload = buildPreviewPayload();
    const content = buildOutlookImportTaskContent({
      payload,
      importedAtIso: "2026-02-18T12:00:00.000Z",
    });
    const text = extractPlainText(content);
    expect(text).toContain("Source: Outlook email import");
    expect(text).toContain("Subject: Follow up with client");
    expect(text).toContain("Message 1");
    expect(text).toContain("Can we review this by Friday?");
    expect(text).not.toContain("Attachments:");
  });

  it("rejects payloads with too many thread messages", () => {
    const payload = buildPreviewPayload();
    payload.thread = Array.from({ length: OUTLOOK_IMPORT_MAX_THREAD_MESSAGES + 1 }).map(
      (_, index) => ({
        messageId: `message-${index + 1}`,
        bodyText: "Body",
      })
    );

    expect(() => prepareOutlookImportPreview(payload)).toThrow(OutlookImportValidationError);
  });

  it("rejects payloads with too many attachment entries", () => {
    const payload = buildPreviewPayload();
    payload.thread[0].attachments = Array.from({ length: OUTLOOK_IMPORT_MAX_ATTACHMENTS + 1 }).map(
      (_, index) => ({
        name: `file-${index + 1}.txt`,
      })
    );

    expect(() => prepareOutlookImportPreview(payload)).toThrow(OutlookImportValidationError);
  });

  it("rejects payloads where normalized text exceeds the byte limit", () => {
    const payload = buildPreviewPayload();
    payload.thread = [
      {
        messageId: "message-1",
        bodyText: "a".repeat(1024 * 1024 + 1000),
      },
    ];

    expect(() => prepareOutlookImportPreview(payload)).toThrow(OutlookImportValidationError);
  });

  it("validates due date/time and normalizes due time for create payloads", () => {
    expect(() =>
      parseOutlookImportCreateRequest({
        previewPayload: buildPreviewPayload(),
        title: "Follow up with client",
        assigneeUserId: "user-1",
        dueTime: "08:30",
      })
    ).toThrow(OutlookImportValidationError);

    const parsed = parseOutlookImportCreateRequest({
      previewPayload: buildPreviewPayload(),
      title: "Follow up with client",
      assigneeUserId: "user-1",
      dueDate: "2026-02-18",
      dueTime: "08:30",
      createDespiteDuplicate: true,
    });
    expect(parsed.dueTime).toBe("08:30:00");
  });

  it("maps duplicate rows to unique task links sorted by recency", () => {
    const rows = [
      {
        task_id: "task-1",
        created_at: "2026-02-17T10:00:00.000Z",
        tasks: { id: "task-1", title: "Existing task older", created_at: "2026-02-17T10:00:00.000Z" },
      },
      {
        task_id: "task-1",
        created_at: "2026-02-18T10:00:00.000Z",
        tasks: { id: "task-1", title: "Existing task newer", created_at: "2026-02-18T10:00:00.000Z" },
      },
      {
        task_id: "task-2",
        created_at: "2026-02-16T10:00:00.000Z",
        tasks: { id: "task-2", title: "Second task", created_at: "2026-02-16T10:00:00.000Z" },
      },
    ];

    const matches = mapOutlookImportDuplicateMatches(rows);
    expect(matches).toEqual([
      {
        taskId: "task-1",
        title: "Existing task newer",
        href: "/tasks/task-1",
        createdAt: "2026-02-18T10:00:00.000Z",
      },
      {
        taskId: "task-2",
        title: "Second task",
        href: "/tasks/task-2",
        createdAt: "2026-02-16T10:00:00.000Z",
      },
    ]);
  });
});
