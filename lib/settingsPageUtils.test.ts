import { describe, expect, it } from "vitest";
import {
  MAX_AVATAR_SIZE_BYTES,
  SETTINGS_EDIT_PERMISSION_MESSAGE,
  TASK_STATUS_OPTION_VALIDATION_MESSAGE,
  USER_AVATARS_BUCKET,
  buildSettingsAssignmentGroupSummary,
  buildSettingsTemplateEntityUrl,
  buildSettingsUserNameLookup,
  checkbox,
  defaultContentText,
  defaultPrefs,
  formatDbError,
  isUuid,
  normalizeSettingsTemplateSearchParams,
  prefValue,
  statusColorValue,
  toInitials,
} from "./settingsPageUtils";

describe("settings page helpers", () => {
  it("exposes settings defaults and constants", () => {
    expect(defaultPrefs.task_assigned).toBe(true);
    expect(defaultPrefs.mention_social).toBe(true);
    expect(defaultContentText).toBe("");
    expect(USER_AVATARS_BUCKET).toBe("user-avatars");
    expect(MAX_AVATAR_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(SETTINGS_EDIT_PERMISSION_MESSAGE).toBe(
      "You do not have permission to manage settings."
    );
    expect(TASK_STATUS_OPTION_VALIDATION_MESSAGE).toContain("to_do");
  });

  it("normalizes display initials and checkbox values", () => {
    const formData = new FormData();
    formData.set("enabled", "on");
    formData.set("disabled", "off");

    expect(toInitials("Jane Mary Doe")).toBe("JM");
    expect(toInitials(" ")).toBe("NA");
    expect(checkbox(formData, "enabled")).toBe(true);
    expect(checkbox(formData, "disabled")).toBe(false);
    expect(checkbox(formData, "missing")).toBe(false);
  });

  it("normalizes status colors and preference fallbacks", () => {
    const formData = new FormData();
    formData.set("short", "abc");
    formData.set("long", "#ABCDEF");
    formData.set("unsafe", "javascript:alert(1)");

    expect(statusColorValue(formData, "short")).toBe("#aabbcc");
    expect(statusColorValue(formData, "long")).toBe("#abcdef");
    expect(statusColorValue(formData, "unsafe")).toBeNull();
    expect(statusColorValue(formData, "missing")).toBeNull();
    expect(prefValue(false, true)).toBe(false);
    expect(prefValue(true, false)).toBe(true);
    expect(prefValue(null, true)).toBe(true);
    expect(prefValue(undefined, false)).toBe(false);
  });

  it("validates UUIDs used by settings actions", () => {
    expect(isUuid("01234567-89ab-4def-8123-456789abcdef")).toBe(true);
    expect(isUuid("01234567-89ab-1def-9123-456789abcdef")).toBe(true);
    expect(isUuid("01234567-89ab-6def-8123-456789abcdef")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("formats database errors with optional details", () => {
    expect(formatDbError("settings.action", null)).toBe("settings.action");
    expect(
      formatDbError("settings.action", {
        message: "Insert failed",
        code: "23505",
        details: "duplicate key",
        hint: "try another name",
      })
    ).toBe(
      "[settings.action] | Insert failed | code=23505 | details=duplicate key | hint=try another name"
    );
  });

  it("normalizes template search params", () => {
    expect(normalizeSettingsTemplateSearchParams(undefined)).toEqual({
      templatesTab: "tasks",
      selectedTaskTemplateId: "",
      selectedProjectTemplateId: "",
      taskTemplatePanel: "details",
      projectTemplatePanel: "details",
      taskTemplatePanelQuery: "&task_template_panel=details",
      projectTemplatePanelQuery: "&project_template_panel=details",
    });

    expect(
      normalizeSettingsTemplateSearchParams({
        templates: " PROJECTS ",
        task_template_id: " task-1 ",
        project_template_id: " project-1 ",
        task_template_panel: "subtasks",
        project_template_panel: "tasks",
      })
    ).toMatchObject({
      templatesTab: "projects",
      selectedTaskTemplateId: "task-1",
      selectedProjectTemplateId: "project-1",
      taskTemplatePanel: "subtasks",
      projectTemplatePanel: "tasks",
    });

    expect(
      normalizeSettingsTemplateSearchParams({
        task_template_panel: "bad",
        project_template_panel: "custom-fields",
      })
    ).toMatchObject({
      taskTemplatePanel: "details",
      projectTemplatePanel: "custom-fields",
    });
  });

  it("builds user and assignment group display summaries", () => {
    const userNameById = buildSettingsUserNameLookup([
      { id: "user-1", full_name: "Morgan Lane", email: "morgan@example.com" },
      { id: "user-2", full_name: null, email: "alex@example.com" },
      { id: "user-3", full_name: null, email: null },
    ]);

    expect(userNameById).toEqual({
      "user-1": "Morgan Lane",
      "user-2": "alex@example.com",
      "user-3": "Unknown user",
    });

    const summary = buildSettingsAssignmentGroupSummary(
      [
        {
          id: "group-1",
          name: "Support",
          memberCount: 3,
          memberUserIds: ["user-2", "user-1", "missing-user"],
        },
        {
          id: "group-2",
          name: "Escalations",
          memberCount: 1,
          memberUserIds: ["user-1"],
        },
      ],
      userNameById
    );

    expect(summary.options).toEqual([
      { id: "group-1", name: "Support", memberCount: 3 },
      { id: "group-2", name: "Escalations", memberCount: 1 },
    ]);
    expect(Array.from(summary.memberIdsByGroupId["group-1"])).toEqual([
      "user-2",
      "user-1",
      "missing-user",
    ]);
    expect(summary.memberLabelsByGroupId["group-1"]).toEqual([
      "alex@example.com",
      "Morgan Lane",
    ]);
    expect(summary.totalMemberSlots).toBe(4);
    expect(summary.uniqueMemberCount).toBe(3);
  });

  it("builds contextual template entity URLs", () => {
    expect(
      buildSettingsTemplateEntityUrl({
        entityType: "task_template",
        entityId: "task template 1",
        taskTemplatePanelQuery: "&task_template_panel=custom-fields",
        projectTemplatePanelQuery: "&project_template_panel=tasks",
        message: { kind: "success", value: "Custom field added" },
      })
    ).toBe(
      "/settings?tab=templates&templates=tasks&task_template_id=task%20template%201&task_template_panel=custom-fields&success=Custom%20field%20added"
    );

    expect(
      buildSettingsTemplateEntityUrl({
        entityType: "project_template",
        entityId: "project-1",
        taskTemplatePanelQuery: "&task_template_panel=subtasks",
        projectTemplatePanelQuery: "&project_template_panel=custom-fields",
        message: { kind: "error", value: "Bad value: A&B" },
      })
    ).toBe(
      "/settings?tab=templates&templates=projects&project_template_id=project-1&project_template_panel=custom-fields&error=Bad%20value%3A%20A%26B"
    );
  });
});
