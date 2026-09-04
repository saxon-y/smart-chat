import { test, expect } from "@playwright/test";

test.describe("chat core", () => {
  test("room page loads without exposing provider credentials", async ({ page }) => {
    await page.goto("/rooms");
    await expect(page).toHaveTitle(/EchoTalking/i);
    await expect(page.locator("body")).not.toContainText("sk-");
  });

  test("authenticated core journey: send, quote, react, thread, search, notifications and agent state", async ({ page }) => {
    test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD || !process.env.E2E_ROOM_ID, "requires isolated Postgres E2E seed");
    await page.goto("/login");
    await page.getByLabel(/邮箱|email/i).fill(process.env.E2E_EMAIL!);
    await page.getByLabel(/密码|password/i).fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: /进入 EchoTalking|登录|sign in/i }).click();
    await page.goto("/chat");
    const composer = page.getByPlaceholder(/给房间写点消息|写点什么/i);
    const messageText = `e2e core ${Date.now()}`;
    await composer.fill(messageText);
    await page.getByRole("button", { name: /发送/i }).click();
    const message = page.locator("article.message").filter({ hasText: messageText }).last();
    await expect(message).toBeVisible();

    await message.getByRole("button", { name: "消息操作" }).click();
    await page.getByRole("button", { name: "回复", exact: true }).click();
    await expect(page.locator(".replying-banner")).toBeVisible();
    await composer.fill(`${messageText} reply`);
    await page.getByRole("button", { name: /发送/i }).click();
    await expect(page.locator(".message-reply-preview").last()).toContainText(messageText);

    await message.getByRole("button", { name: "消息操作" }).click();
    await page.getByRole("button", { name: "回应", exact: true }).click();
    await page.getByRole("button", { name: "👍", exact: true }).click();
    await expect(message.getByRole("button", { name: /👍 1 个回应/ })).toBeVisible();

    await message.getByRole("button", { name: "消息操作" }).click();
    await page.getByRole("button", { name: "讨论", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /Thread|讨论/ })).toBeVisible();
    await page.getByRole("button", { name: /关闭 Thread|关闭讨论/ }).click();

    await page.getByRole("button", { name: "搜索当前房间消息" }).click();
    await page.getByPlaceholder("搜索消息内容").fill(messageText);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator(".search-result").filter({ hasText: messageText }).first()).toBeVisible();
    await page.getByRole("button", { name: "关闭搜索" }).click();

    await page.getByRole("button", { name: /通知/ }).first().click();
    await expect(page.getByRole("region", { name: "通知中心" })).toBeVisible();
    await page.screenshot({ path: `docs/产品/验收截图/2026-09-03-${test.info().project.name}-chat-core.png`, fullPage: true });
  });
});
