import { expect, test, type Page } from "@playwright/test";

const taskTitlePrefix = "E2E smoke task";

async function expectNoNextErrorOverlay(page: Page) {
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0);
}

async function signInWithCredentials(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set E2E_STORAGE_STATE, or set E2E_EMAIL and E2E_PASSWORD for the task smoke test."
    );
  }

  await page.goto(`/login?return_to=${encodeURIComponent("/tasks")}`);
  const signInForm = page.locator("form").first();
  await signInForm.locator('input[name="email"]').fill(email);
  await signInForm.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/tasks(?:[/?#]|$)/, { timeout: 30_000 }),
    signInForm.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

async function ensureSignedIn(page: Page) {
  await page.goto("/tasks");
  if (!/\/login(?:[/?#]|$)/.test(page.url())) {
    return;
  }

  await signInWithCredentials(page);
}

test("signed-in task quick-add and notes flow has no red client errors", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await test.step("sign in and load tasks", async () => {
    await ensureSignedIn(page);
    await page.goto("/tasks?view=table");
    await expect(page).toHaveURL(/\/tasks(?:[/?#]|$)/);
    await expect(page.getByRole("button", { name: /^Add task$/ })).toBeVisible();
    await expectNoNextErrorOverlay(page);
  });

  const uniqueSuffix = Date.now().toString(36);
  const title = `${taskTitlePrefix} ${uniqueSuffix}`;
  const notes = `Smoke note created at ${new Date().toISOString()}`;
  const subtaskTitle = `Smoke subtask ${uniqueSuffix}`;

  await test.step("create task with notes and a subtask", async () => {
    await page.getByRole("button", { name: /^Add task$/ }).first().click();

    const dialog = page.getByRole("dialog", { name: "Add task" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Task notes").fill(notes);
    await dialog.getByText("Subtasks", { exact: true }).click();
    await dialog.getByLabel("Subtask 1").fill(subtaskTitle);
    await dialog.getByRole("button", { name: /^Add task$/ }).click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: title }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expectNoNextErrorOverlay(page);
  });

  await test.step("open task detail and update notes", async () => {
    await page.getByRole("link", { name: title }).first().click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+(?:[/?#]|$)/, {
      timeout: 30_000,
    });
    await page.getByRole("link", { name: "Notes" }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\?tab=notes/, {
      timeout: 30_000,
    });

    const editor = page.locator(".ProseMirror").first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(`\nSmoke note update ${uniqueSuffix}`);

    await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Save failed", { exact: true })).toHaveCount(0);
    await expectNoNextErrorOverlay(page);
  });

  expect(pageErrors).toEqual([]);
});
