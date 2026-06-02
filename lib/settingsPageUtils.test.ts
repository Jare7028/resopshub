import { describe, expect, it } from "vitest";
import {
  MAX_AVATAR_SIZE_BYTES,
  SETTINGS_EDIT_PERMISSION_MESSAGE,
  TASK_STATUS_OPTION_VALIDATION_MESSAGE,
  USER_AVATARS_BUCKET,
  buildSettingsAssignmentGroupSummary,
  buildSettingsNotificationPrefs,
  buildSettingsProfileDisplay,
  buildSettingsProjectTemplateUrl,
  buildSettingsProjectTemplateTaskReturnUrl,
  buildSettingsStatusFormInput,
  buildSettingsStatusRowsWithIds,
  buildSettingsStatusSummary,
  buildSettingsTaskTemplateUrl,
  buildSettingsTemplateCustomFieldSummary,
  buildSettingsTemplateEntityUrl,
  buildSettingsTemplateRelationshipSummary,
  buildSettingsUserNameLookup,
  checkbox,
  defaultContentText,
  defaultPrefs,
  formatDbError,
  isUuid,
  normalizeSettingsStatusEntityType,
  normalizeSettingsStatusPosition,
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
    expect(
      buildSettingsProfileDisplay({
        email: "fallback@example.com",
        full_name: " Ada Lovelace ",
        avatar_url: " https://example.com/avatar.png ",
      })
    ).toEqual({
      displayName: "Ada Lovelace",
      initials: "AL",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(
      buildSettingsProfileDisplay({
        email: null,
        full_name: " ",
        avatar_url: null,
      })
    ).toMatchObject({
      displayName: "User",
      initials: "U",
      avatarUrl: "",
    });
  });

  it("normalizes status colors and preference fallbacks", () => {
    const formData = new FormData();
    formData.set("short", "abc");
    formData.set("long", "#ABCDEF");
    formData.set("unsafe", "javascript:alert(1)");
    const statusFormData = new FormData();
    statusFormData.set("entity_type", " FEATURE_SUGGESTION ");
    statusFormData.set("value", "Needs checking!");
    statusFormData.set("is_visible", "on");
    statusFormData.set("counts_as_completed", "on");
    statusFormData.set("color_hex", " 00AAFF ");

    expect(statusColorValue(formData, "short")).toBe("#aabbcc");
    expect(statusColorValue(formData, "long")).toBe("#abcdef");
    expect(statusColorValue(formData, "unsafe")).toBeNull();
    expect(statusColorValue(formData, "missing")).toBeNull();
    expect(normalizeSettingsStatusEntityType("bad")).toBe("task");
    expect(normalizeSettingsStatusEntityType("project")).toBe("project");
    expect(normalizeSettingsStatusPosition("3.9")).toBe(3);
    expect(normalizeSettingsStatusPosition("0")).toBe(1);
    expect(buildSettingsStatusFormInput(statusFormData)).toEqual({
      entityType: "feature_suggestion",
      value: "needs_checking",
      isVisible: true,
      countsAsCompleted: true,
      rawColorHex: "00AAFF",
      colorHex: "#00aaff",
    });
    expect(prefValue(false, true)).toBe(false);
    expect(prefValue(true, false)).toBe(true);
    expect(prefValue(null, true)).toBe(true);
    expect(prefValue(undefined, false)).toBe(false);
    expect(
      buildSettingsNotificationPrefs("user-1", {
        user_id: "user-1",
        task_assigned: false,
        task_updated: null,
        task_due_today: true,
        task_overdue: null,
        feature_suggestion_comment: null,
        feature_suggestion_status: false,
        mentions_enabled: null,
        mention_task: false,
        mention_notes: null,
        mention_chat: true,
        mention_social: null,
        mention_feature_suggestion: null,
        mention_form_submission: false,
        mention_quiz: null,
        schedule_updates: true,
      })
    ).toMatchObject({
      user_id: "user-1",
      task_assigned: false,
      task_updated: true,
      task_due_today: true,
      feature_suggestion_status: false,
      mentions_enabled: true,
      mention_task: false,
      mention_form_submission: false,
      schedule_updates: true,
    });
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

    expect(
      buildSettingsTaskTemplateUrl({
        taskTemplateId: " task-1 ",
        taskTemplatePanelQuery: "&task_template_panel=subtasks",
        message: { kind: "success", value: "Subtask updated" },
      })
    ).toBe(
      "/settings?tab=templates&templates=tasks&task_template_id=task-1&task_template_panel=subtasks&success=Subtask%20updated"
    );

    expect(
      buildSettingsProjectTemplateUrl({
        projectTemplateId: "",
        projectTemplatePanelQuery: "&project_template_panel=tasks",
      })
    ).toBe("/settings?tab=templates&templates=projects&project_template_panel=tasks");

    expect(
      buildSettingsProjectTemplateTaskReturnUrl({
        returnTemplatesTab: "tasks",
        returnTaskTemplateId: "task-2",
        projectTemplateId: "project-2",
        taskTemplatePanelQuery: "&task_template_panel=details",
        projectTemplatePanelQuery: "&project_template_panel=tasks",
        message: { kind: "success", value: "Project template linked" },
      })
    ).toBe(
      "/settings?tab=templates&templates=tasks&task_template_id=task-2&task_template_panel=details&success=Project%20template%20linked"
    );

    expect(
      buildSettingsProjectTemplateTaskReturnUrl({
        returnTemplatesTab: "projects",
        returnTaskTemplateId: "task-2",
        projectTemplateId: "project-2",
        taskTemplatePanelQuery: "&task_template_panel=details",
        projectTemplatePanelQuery: "&project_template_panel=tasks",
        message: { kind: "error", value: "Missing link id" },
      })
    ).toBe(
      "/settings?tab=templates&templates=projects&project_template_id=project-2&project_template_panel=tasks&error=Missing%20link%20id"
    );

    expect(
      buildSettingsProjectTemplateTaskReturnUrl({
        returnTemplatesTab: "projects",
        returnTaskTemplateId: "task-2",
        projectTemplateId: "project-2",
        taskTemplatePanelQuery: "&task_template_panel=details",
        projectTemplatePanelQuery: "&project_template_panel=tasks",
        includeProjectContext: false,
        message: { kind: "error", value: "Missing link id" },
      })
    ).toBe("/settings?tab=templates&templates=projects&error=Missing%20link%20id");
  });

  it("builds template relationship maps and selected task-template summaries", () => {
    const summary = buildSettingsTemplateRelationshipSummary({
      taskTemplates: [
        { id: "task-a", name: "Task A" },
        { id: "task-b", name: "Task B" },
      ],
      projectTemplates: [
        { id: "project-z", name: "Zulu" },
        { id: "project-a", name: "Alpha" },
        { id: "project-m", name: "Mike" },
      ],
      taskTemplateSubtasks: [
        { id: "sub-1", task_template_id: "task-a", title: "First" },
        { id: "sub-2", task_template_id: "task-a", title: "Second" },
      ],
      projectTemplateTasks: [
        { id: "link-z", project_template_id: "project-z", task_template_id: "task-a" },
        { id: "link-a", project_template_id: "project-a", task_template_id: "task-a" },
        { id: "link-b", project_template_id: "project-m", task_template_id: "task-b" },
      ],
      taskTemplateAssignees: [
        { task_template_id: "task-a", user_id: "user-2" },
        { task_template_id: "task-a", user_id: "user-1" },
      ],
      taskTemplateSubtaskAssignees: [
        { task_template_subtask_id: "sub-1", user_id: "user-3" },
      ],
      selectedTaskTemplateId: "task-a",
    });

    expect(summary.subtasksByTemplateId["task-a"].map((row) => row.id)).toEqual([
      "sub-1",
      "sub-2",
    ]);
    expect(summary.tasksByProjectTemplateId["project-m"].map((row) => row.id)).toEqual([
      "link-b",
    ]);
    expect(summary.assigneeIdsByTaskTemplateId["task-a"]).toEqual(["user-2", "user-1"]);
    expect(summary.assigneeIdsByTaskTemplateSubtaskId["sub-1"]).toEqual(["user-3"]);
    expect(summary.taskTemplateById["task-b"]?.name).toBe("Task B");
    expect(summary.projectTemplateById["project-a"]?.name).toBe("Alpha");
    expect(summary.selectedTaskTemplateAssigneeIds).toEqual(["user-2", "user-1"]);
    expect(summary.selectedTaskTemplateProjectLinks.map((link) => link.id)).toEqual([
      "link-a",
      "link-z",
    ]);
    expect(Array.from(summary.selectedTaskTemplateLinkedProjectTemplateIds)).toEqual([
      "project-a",
      "project-z",
    ]);
    expect(summary.availableProjectTemplatesForTaskTemplate.map((project) => project.id)).toEqual([
      "project-m",
    ]);
  });

  it("builds template custom-field selections, option groups, and values", () => {
    const summary = buildSettingsTemplateCustomFieldSummary({
      templateCustomFields: [
        {
          id: "field-task",
          entity_type: "task_template",
          entity_id: "task-a",
          label: "Task field",
        },
        {
          id: "field-project",
          entity_type: "project_template",
          entity_id: "project-a",
          label: "Project field",
        },
        {
          id: "field-other",
          entity_type: "task",
          entity_id: "task-a",
          label: "Other field",
        },
      ],
      templateCustomFieldOptions: [
        { id: "option-1", field_id: "field-task", value: "One" },
        { id: "option-2", field_id: "field-task", value: "Two" },
        { id: "option-3", field_id: "field-project", value: "Three" },
      ],
      templateCustomFieldValues: [
        { field_id: "field-task", text_value: "Text fallback", option_value: "Two" },
        { field_id: "field-project", text_value: "Project text", option_value: null },
        { field_id: "field-empty", text_value: null, option_value: null },
      ],
      selectedTaskTemplateId: "task-a",
      selectedProjectTemplateId: "project-a",
    });

    expect(summary.selectedTaskTemplateCustomFields.map((field) => field.id)).toEqual([
      "field-task",
    ]);
    expect(summary.selectedProjectTemplateCustomFields.map((field) => field.id)).toEqual([
      "field-project",
    ]);
    expect(summary.templateCustomFieldOptionsByFieldId["field-task"].map((option) => option.id)).toEqual([
      "option-1",
      "option-2",
    ]);
    expect(summary.templateCustomFieldValueByFieldId.get("field-task")).toBe("Two");
    expect(summary.templateCustomFieldValueByFieldId.get("field-project")).toBe(
      "Project text"
    );
    expect(summary.templateCustomFieldValueByFieldId.get("field-empty")).toBe("");
  });

  it("adds database ids to status metadata rows by entity and normalized value", () => {
    const statusOptions = [
      {
        id: "status-1",
        entity_type: "task" as const,
        value: "To Do",
        position: 1,
      },
      {
        id: "status-2",
        entity_type: "project" as const,
        value: "in_progress",
        position: 2,
      },
      {
        id: "status-3",
        entity_type: "feature_suggestion" as const,
        value: "blocked pending",
        position: 6,
        is_visible: true,
        counts_as_completed: false,
      },
    ];
    const rows = buildSettingsStatusRowsWithIds(
      "task",
      [
        {
          value: "to_do",
          position: 1,
          isVisible: true,
          countsAsCompleted: false,
          colorHex: "#64748b",
        },
        {
          value: "in_progress",
          position: 2,
          isVisible: true,
          countsAsCompleted: false,
          colorHex: "#3b82f6",
        },
        {
          value: "missing",
          position: 3,
          isVisible: true,
          countsAsCompleted: false,
          colorHex: "#64748b",
        },
      ],
      statusOptions
    );
    const summary = buildSettingsStatusSummary(statusOptions);

    expect(rows.map((row) => row.id)).toEqual(["status-1", "", ""]);
    expect(summary.taskStatusOptions).toContain("to_do");
    expect(summary.projectStatusOptions).toContain("in_progress");
    expect(summary.statusSections.map((section) => section.entityType)).toEqual([
      "task",
      "project",
      "feature_suggestion",
    ]);
    expect(summary.statusSections[2].rows.some((row) => row.id === "status-3")).toBe(true);
  });
});
