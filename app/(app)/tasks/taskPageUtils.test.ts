import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import {
  areSameValueSets,
  buildTasksRedirectUrl,
  buildTasksShellListHref,
  buildTasksUrlWithoutMessage,
  defaultTaskContentText,
  formatDbError,
  isLegacyTaskListPageSignatureError,
  isStaleLegacyTaskListPageErrorMessage,
  isTemplateStatusEnumError,
  legacyTaskListRowMatchesSearch,
  normalizeTemplateStatusForCreate,
  resolveTaskContentFromSource,
} from "./taskPageUtils";

describe("task page utilities", () => {
  it("resolves task content from saved content, descriptions, and defaults", () => {
    const savedContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Saved note" }] }],
    };
    expect(
      resolveTaskContentFromSource({
        content: savedContent,
        content_text: "Saved text",
        description: "Ignored",
      })
    ).toEqual({ content: savedContent, contentText: "Saved text" });

    const fromDescription = resolveTaskContentFromSource({
      description: "Call the client",
    });
    expect(fromDescription.contentText).toBe("Call the client");

    expect(resolveTaskContentFromSource(null)).toEqual({
      content: DEFAULT_EDITOR_CONTENT,
      contentText: defaultTaskContentText,
    });
  });

  it("compares unordered string sets", () => {
    expect(areSameValueSets(["b", "a"], ["a", "b"])).toBe(true);
    expect(areSameValueSets(["a", "a"], ["a"])).toBe(false);
    expect(areSameValueSets(["a"], ["b"])).toBe(false);
  });

  it("formats database errors with optional diagnostics", () => {
    expect(formatDbError("tasks.page", null)).toBe("tasks.page");
    expect(
      formatDbError("tasks.page", {
        message: "Failed",
        code: "PGRST202",
        details: "missing argument",
        hint: "refresh schema",
      })
    ).toBe(
      "[tasks.page] | Failed | code=PGRST202 | details=missing argument | hint=refresh schema"
    );
  });

  it("detects template enum and legacy task list errors", () => {
    expect(
      isTemplateStatusEnumError({
        message: 'invalid input value for enum task_status: "template"',
      })
    ).toBe(true);

    const legacyError = {
      code: "PGRST202",
      message: "Could not find the function public.task_list_page in the schema cache",
      hint: "Perhaps you meant task_list_page(p_offset, p_query)",
    };
    expect(isLegacyTaskListPageSignatureError(legacyError)).toBe(true);
    expect(isLegacyTaskListPageSignatureError({ code: "PGRST202", message: "Other" })).toBe(
      false
    );

    const staleMessage = formatDbError("tasks.page.task_list_page", legacyError);
    expect(isStaleLegacyTaskListPageErrorMessage(staleMessage)).toBe(true);
    expect(isStaleLegacyTaskListPageErrorMessage("unrelated")).toBe(false);
  });

  it("builds task route URLs without transient messages", () => {
    expect(
      buildTasksUrlWithoutMessage({
        tab: "add",
        q: "billing issue",
        error: "old error",
        success: "old success",
      })
    ).toBe("/tasks?tab=add&q=billing+issue");

    expect(
      buildTasksRedirectUrl("/tasks?tab=add&q=billing&error=old", {
        tab: "list",
        success: "Task created",
      })
    ).toBe("/tasks?q=billing&success=Task+created");

    expect(
      buildTasksRedirectUrl("/tasks?q=billing", {
        tab: "add",
        error: "Missing title",
      })
    ).toBe("/tasks?q=billing&tab=add&error=Missing+title");
  });

  it("builds shell list hrefs with repeated array params", () => {
    expect(
      buildTasksShellListHref({
        status: ["to_do", "in_progress"],
        priority: "high",
        assignee: ["u1", "u2"],
        q: "refund",
        page: "2",
        error: "ignored",
      })
    ).toBe(
      "/tasks?status=to_do&status=in_progress&priority=high&assignee=u1&assignee=u2&q=refund&page=2"
    );

    expect(buildTasksShellListHref(undefined)).toBe("/tasks");
  });

  it("matches legacy task rows against search text", () => {
    const row = {
      title: "Follow up",
      client_name: "Acme Support",
      project_name: "Onboarding",
    };

    expect(legacyTaskListRowMatchesSearch(row, "")).toBe(true);
    expect(legacyTaskListRowMatchesSearch(row, "support")).toBe(true);
    expect(legacyTaskListRowMatchesSearch(row, "billing")).toBe(false);
  });

  it("normalizes template statuses for creation", () => {
    expect(normalizeTemplateStatusForCreate(null)).toBe("to_do");
    expect(normalizeTemplateStatusForCreate("template")).toBe("to_do");
    expect(normalizeTemplateStatusForCreate("backlog")).toBe("to_do");
    expect(normalizeTemplateStatusForCreate("completed")).toBe("completed");
  });
});
