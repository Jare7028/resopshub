import { describe, expect, it } from "vitest";
import {
  CONTEXT_MENU_FAVORITE_ACTIONS,
  CONTEXT_MENU_FAVORITE_ACTION_ID_SET,
  CONTEXT_MENU_FAVORITES_STORAGE_KEY,
  normalizeContextMenuFavoriteIds,
} from "./noteEditorContextMenu";

describe("note editor context menu helpers", () => {
  it("keeps the favorite action list and id set in sync", () => {
    const actionIds = CONTEXT_MENU_FAVORITE_ACTIONS.map((action) => action.id);

    expect(actionIds.length).toBe(CONTEXT_MENU_FAVORITE_ACTION_ID_SET.size);
    actionIds.forEach((actionId) => {
      expect(CONTEXT_MENU_FAVORITE_ACTION_ID_SET.has(actionId)).toBe(true);
    });
  });

  it("includes formatting and object actions that personal pages persist", () => {
    expect(CONTEXT_MENU_FAVORITE_ACTION_ID_SET.has("bold")).toBe(true);
    expect(CONTEXT_MENU_FAVORITE_ACTION_ID_SET.has("fontSizeUp")).toBe(true);
    expect(CONTEXT_MENU_FAVORITE_ACTION_ID_SET.has("insertArrow")).toBe(true);
    expect(CONTEXT_MENU_FAVORITE_ACTION_ID_SET.has("deleteTable")).toBe(true);
  });

  it("normalizes favorite ids by trimming, filtering, and de-duping", () => {
    expect(
      normalizeContextMenuFavoriteIds([
        " bold ",
        "unknown",
        "",
        null,
        "insertArrow",
        "bold",
      ])
    ).toEqual(["bold", "insertArrow"]);
  });

  it("uses the stable local storage key", () => {
    expect(CONTEXT_MENU_FAVORITES_STORAGE_KEY).toBe(
      "note_editor_context_favorites_v1"
    );
  });
});
