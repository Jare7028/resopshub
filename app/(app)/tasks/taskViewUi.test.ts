import { describe, expect, it } from "vitest";
import {
  buildTaskPaginationSummary,
  computeAnchoredPanelPosition,
  computeTaskNotesHoverPosition,
  getTaskHeaderMenuPanelWidth,
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
});
