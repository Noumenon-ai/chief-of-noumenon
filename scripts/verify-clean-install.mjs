// Runs only inside the disposable proof container, against loopback services.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "../desktop/node_modules/playwright/index.mjs";
const origin = "http://127.0.0.1:8000";
let completionCalls = 0;
const fake = createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ data: [{ id: "clean-install-model" }] }));
  }
  if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
    res.writeHead(404); return res.end();
  }
  let input = "";
  for await (const chunk of req) input += chunk;
  const body = JSON.parse(input);
  assert.equal(body.model, "clean-install-model");
  assert.ok(body.messages.length);
  completionCalls++;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end('data: {"choices":[{"delta":{"content":"CLEAN_INSTALL_REPLY"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
let browser;
try {
  await new Promise(resolve => fake.listen(18123, "127.0.0.1", resolve));
  let healthy = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { healthy = (await fetch(origin + "/api/v1/health")).ok; } catch { /* startup */ }
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(healthy, "health did not become ready");
  console.log("PASS health without an installed engine");
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-background-networking"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(origin + "/login/");
  await page.getByRole("heading", { name: "Create your sign-in code", exact: true }).waitFor();
  await page.getByLabel("Sign-in code", { exact: true }).fill("disposable install proof only");
  await page.getByLabel("Repeat it", { exact: true }).fill("disposable install proof only");
  await page.getByRole("button", { name: "Create and sign in", exact: true }).click();
  // OnboardingApp renders FirstRun for a fresh install with no bots. Its three
  // engine paths remain; the CLI/API paths now use installed-AI/account wording.
  await page.getByRole("heading", { name: "Choose how Chief can work", exact: true }).waitFor();
  console.log("PASS login and first-run redirect");
  for (const name of ["Use an AI already installed", "Connect an AI account", "Use a local model"]) {
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  console.log("PASS first-run three engine paths");
  await page.getByLabel("Service address", { exact: true }).fill("http://127.0.0.1:18123/v1");
  await page.getByLabel("Model", { exact: true }).fill("clean-install-model");
  await page.getByLabel("Account key", { exact: true }).fill("synthetic-install-key");
  await page.getByRole("button", { name: "Save account settings", exact: true }).click();
  await page.getByRole("heading", { name: "Chief is ready", exact: true }).waitFor();
  const session = await (await page.request.get(origin + "/api/v1/auth/session")).json();
  const headers = { "X-CSRF-Token": session.csrf_token, Origin: origin };
  const bots = await (await page.request.get(origin + "/api/v1/agents")).json();
  const bot = bots.find(bot => bot.provider === "openai_compat");
  assert.ok(bot, "first run did not create an API bot");
  const made = await page.request.post(origin + "/api/v1/threads", { headers, data: { agent_id: bot.id, provider: "openai_compat" } });
  assert.equal(made.status(), 201);
  const thread = await made.json();
  const sent = await page.request.post(`${origin}/api/v1/threads/${thread.id}/turns`, { headers, data: { prompt_text: "Reply with the scripted install proof." } });
  assert.equal(sent.status(), 202);
  let result;
  for (let attempt = 0; attempt < 120; attempt++) {
    result = await (await page.request.get(`${origin}/api/v1/threads/${thread.id}`)).json();
    if (result.turns?.some(turn => ["succeeded", "failed", "completed"].includes(turn.status))) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(result.turns?.some(turn => turn.result === "CLEAN_INSTALL_REPLY"), "API turn did not return the scripted answer");
  assert.ok(completionCalls > 0);
  assert.deepEqual(errors, []);
  console.log("PASS API key engine through scripted local endpoint");
  console.log("5 clean-install checks passed, 0 failed");
} finally {
  await browser?.close();
  await new Promise(resolve => fake.close(resolve));
}
