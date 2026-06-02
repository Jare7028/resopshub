import { describe, expect, it } from "vitest";
import {
  buildTaskCardMeta,
  buildTaskEntityNameLookup,
  buildTaskPaginationSummary,
  buildTaskStatusColorLookup,
  buildTaskTableColumns,
  buildTaskUserNameLookup,
  computeAnchoredPanelPosition,
  computeTaskNotesHoverPosition,
  countVisibleTaskTableColumns,
  getTaskAssigneeLabel,
  getTaskHeaderMenuPanelWidth,
  resolveTaskStatusColor,
} from "./taskViewUi";

describe("task view UI helpers", () => {
  it("sizes header filter menus by menu type", () => {
    expect(getTaskHeaderMenuPanelWidth("due")).toBe(256);
    expect(getTaskHeaderMenuPanelWidth("client")).toBe(288);
    expect(getTaskHeaderMenuPanelWidth("assignees")).toBe(288);
  });

  it("places anchored panels within the viewport", () => {
    expect(
      computeAnchoredPanelPosition({
        rect: { right: 500, bottom: 40 },
        panelWidth: 288,
        viewportWidth: 1000,
      })
    ).toEqual({ left: 212, top: 48 });

    expect(
      computeAnchoredPanelPosition({
        rect: { right: 1200, bottom: 0 },
        panelWidth: 288,
        viewportWidth: 1000,
      })
    ).toEqual({ left: 704, top: 8 });

    expect(
      computeAnchoredPanelPosition({
        rect: { right: 40, bottom: 10 },
        panelWidth: 288,
        viewportWidth: 1000,
      })
    ).toEqual({ left: 8, top: 18 });
  });

  it("places task notes hover panels within the viewport", () => {
    expect(
      computeTaskNotesHoverPosition({
        anchor: { left: 100, bottom: 100 },
        viewportWidth: 1200,
        viewportHeight: 800,
      })
    ).toEqual({ x: 100, y: 108 });

    expect(
      computeTaskNotesHoverPosition({
        anchor: { left: 1190, bottom: 780 },
        viewportWidth: 1200,
        viewportHeight: 800,
      })
    ).toEqual({ x: 868, y: 568 });

    expect(
      computeTaskNotesHoverPosition({
        anchor: { left: -50, bottom: -40 },
        viewportWidth: 200,
        viewportHeight: 180,
      })
    ).toEqual({ x: 12, y: 12 });
  });

  it("normalizes pagination summary values", () => {
    expect(
      buildTaskPaginationSummary({
        currentPage: 2,
        pageSize: 25,
        totalTaskCount: 70,
        locallyVisibleQuickTaskCount: 2,
      })
    ).toEqual({
      normalizedPage: 2,
      normalizedPageSize: 25,
      normalizedTotalCount: 72,
      showingFrom: 26,
      showingTo: 50,
      hasPreviousPage: true,
      hasNextPage: true,
    });

    expect(
      buildTaskPaginationSummary({
        currentPage: -1,
        pageSize: 0,
        totalTaskCount: -10,
      })
    ).toEqual({
      normalizedPage: 1,
      normalizedPageSize: 1,
      normalizedTotalCount: 0,
      showingFrom: 0,
      showingTo: 0,
      hasPreviousPage: false,
      hasNextPage: false,
    });

    expect(
      buildTaskPaginationSummary({
        currentPage: 4,
        pageSize: 10,
        totalTaskCount: 35,
      })
    ).toMatchObject({
      showingFrom: 31,
      showingTo: 35,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });

  it("builds status color lookups with custom and fallback colors", () => {
    const lookup = buildTaskStatusColorLookup({
      statusOptions: ["To Do", "Custom Status"],
      statusColorMap: {
        to_do: "#111111",
        "Custom Status": "#222222",
      },
    });

    expect(resolveTaskStatusColor("to_do", lookup)).toBe("#111111");
    expect(resolveTaskStatusColor("Custom Status", lookup)).toBe("#222222");
    expect(resolveTaskStatusColor("Missing", lookup)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(resolveTaskStatusColor(null, lookup)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("builds task label lookups and assignee summaries", () => {
    const usersById = buildTaskUserNameLookup([
      { id: "u1", full_name: "Ada Lovelace", email: "ada@example.com" },
      { id: "u2", full_name: null, email: "grace@example.com" },
      { id: "u3", full_name: null, email: null },
    ]);

    expect(usersById).toEqual({
      u1: "Ada Lovelace",
      u2: "grace@example.com",
      u3: "Unknown user",
    });
    expect(buildTaskEntityNameLookup([{ id: "c1", name: "Acme" }])).toEqual({
      c1: "Acme",
    });
    expect(getTaskAssigneeLabel([], usersById)).toBe("Unassigned");
    expect(getTaskAssigneeLabel(["u1"], usersById)).toBe("Ada Lovelace");
    expect(getTaskAssigneeLabel(["missing"], usersById)).toBe("Assigned");
    expect(getTaskAssigneeLabel(["u2", "u1"], usersById)).toBe("grace@example.com +1");
  });

  it("builds reusable task card display metadata", () => {
    expect(
      buildTaskCardMeta({
        task: {
          priority: null,
          due_date: null,
          due_time: null,
          client_id: "c1",
          project_id: "p1",
        },
        clientNameById: { c1: "Acme" },
        projectNameById: { p1: "Migration" },
      })
    ).toEqual({
      priorityLabel: "medium",
      dueLabel: "No due date",
      dueUrgency: "none",
      clientName: "Acme",
      projectName: "Migration",
    });

    expect(
      buildTaskCardMeta({
        task: {
          priority: "HIGH",
          due_date: null,
          client_id: "missing",
          project_id: null,
        },
        clientNameById: {},
        projectNameById: {},
        noDueDateLabel: "",
      })
    ).toMatchObject({
      priorityLabel: "high",
      dueLabel: "",
      clientName: null,
      projectName: null,
    });
  });

  it("builds table columns with optional next-subtask due support", () => {
    expect(
      buildTaskTableColumns({ supportsNextSubtaskDueDateColumn: false }).map(
        (column) => column.id
      )
    ).toEqual([
      "task",
      "open_subtasks",
      "client",
      "project",
      "status",
      "priority",
      "assignees",
      "start",
      "due",
    ]);

    expect(
      buildTaskTableColumns({ supportsNextSubtaskDueDateColumn: true }).map(
        (column) => column.id
      )
    ).toContain("next_subtask_due");
    expect(
      buildTaskTableColumns({ supportsNextSubtaskDueDateColumn: true })[0]
    ).toEqual({ id: "task", label: "Task", required: true });
  });

  it("counts visible task table columns", () => {
    const columns = buildTaskTableColumns({
      supportsNextSubtaskDueDateColumn: true,
    }).map((column) => column.id);
    const hiddenColumns = new Set(["client", "next_subtask_due", "priority"]);

    expect(
      countVisibleTaskTableColumns({
        columnIds: columns,
        isColumnVisible: (columnId) => !hiddenColumns.has(columnId),
      })
    ).toBe(columns.length - hiddenColumns.size);
  });
});
