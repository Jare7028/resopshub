import { describe, expect, it } from "vitest";
import {
  MAX_AVATAR_SIZE_BYTES,
  SETTINGS_EDIT_PERMISSION_MESSAGE,
  TASK_STATUS_OPTION_VALIDATION_MESSAGE,
  USER_AVATARS_BUCKET,
  checkbox,
  defaultContentText,
  defaultPrefs,
  formatDbError,
  isUuid,
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
});
