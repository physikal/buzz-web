import { chromium } from "@playwright/test";

const setupUrl = process.env.BUZZ_OWNER_SETUP_URL;
if (!setupUrl) throw new Error("BUZZ_OWNER_SETUP_URL is required.");
const origin = new URL(setupUrl).origin;
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });

  await page.goto(setupUrl);
  await page.getByRole("button", { name: "Create owner passkey" }).click();
  await page
    .getByLabel("I saved this vault unlock code somewhere secure.")
    .check();
  await page.getByRole("button", { name: "Open Buzz" }).click();
  await page.getByRole("heading", { name: "general" }).waitFor();

  await page.getByRole("button", { name: "Start huddle" }).click();
  const startDialog = page.getByRole("dialog", { name: "Start huddle" });
  await startDialog.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("region", { name: "Active huddle" }).waitFor();

  await page.getByRole("button", { name: "Huddle audio settings" }).click();
  await page.getByRole("button", { name: "Push to talk" }).click();
  await page.keyboard.down("Control");
  await page.keyboard.down("Space");
  await page.getByRole("button", { name: "Push to talk active" }).waitFor();
  await page.keyboard.up("Space");
  await page.keyboard.up("Control");
  await page.getByRole("button", { name: "Push to talk ready" }).waitFor();

  const microphone = page.getByLabel("Microphone", { exact: true });
  const microphoneElement = await microphone.elementHandle();
  await page.waitForFunction(
    (element) =>
      element instanceof HTMLSelectElement && element.options.length > 1,
    microphoneElement,
  );
  const microphoneOptions = await microphone.locator("option").count();
  if (microphoneOptions < 2)
    throw new Error("The browser did not expose its fake microphone.");
  await microphone.selectOption({ index: 1 });
  await page.getByLabel("Input volume").fill("1.25");
  await page.getByRole("button", { name: "Huddle audio settings" }).click();

  await page.getByRole("button", { name: "Emoji reactions" }).click();
  await page.getByRole("button", { name: "🎉" }).click();
  await page.getByText("🎉", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Add agent to huddle" }).click();
  await page.getByText("No additional running agents").waitFor();
  await page
    .getByRole("dialog", { name: "Add agent to huddle" })
    .getByRole("button", { name: "Close" })
    .click();

  await page.getByRole("button", { name: "Leave huddle" }).click();
  await page.getByRole("region", { name: "Active huddle" }).waitFor({
    state: "detached",
  });
  if (pageErrors.length) throw new Error(pageErrors.join("\n"));
  console.log(
    JSON.stringify({
      ok: true,
      origin,
      microphoneOptions,
      controls: [
        "push-to-talk",
        "input-device",
        "gain",
        "reaction",
        "agent-add",
      ],
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
