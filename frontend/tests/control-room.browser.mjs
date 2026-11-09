// Real browser layout checks against isolated API fixtures. No live backend requests.
// Start the built frontend on 127.0.0.1:3935, then run with CHROMIUM_PATH set locally.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const screenshots = new URL("../.next/owner-review/", import.meta.url).pathname;
await mkdir(screenshots, { recursive: true });
import { chromium } from "../../desktop/node_modules/playwright/index.mjs";
const origin = process.env.CONTROL_ROOM_URL || "http://127.0.0.1:3935";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox", "--disable-background-networking"] });
const timestamp = "2026-11-03T12:00:00Z";
const bot = { id: 1, name: "Review bot", provider: "claude", model: "test-model", archived_at: null, pinned: true, approval_mode: "ask", memory_enabled: false, workspace_path: "/host/bots/review", computer: null, instructions: "", created_at: timestamp, updated_at: timestamp };
const thread = { id: 1, agent_id: 1, title: "Review a request", origin: "telegram", provider: "claude", model: "test-model", session_state: "active", last_seq: 4, archived_at: null, created_at: timestamp, updated_at: timestamp, active_turn_id: 1, turns: [{ id: 1, prompt_text: "Review this change", result: null, status: "running" }], computer: null };
const event = (seq, type, data) => ({ thread_id: 1, turn_id: 1, seq, type, data, ts: timestamp });
const initialEvents = [event(1,"turn.started",{prompt_text:"Review this change"}), event(2,"assistant.message",{text:"The draft is ready for your review."}), event(3,"assistant.message",{text:"אפשר לבדוק את הפרטים לפני שמאשרים."}), event(4,"approval.requested",{approval_id:"test-approval",tool:"mcp__composio__apps_run",kind:"other",summary:"Review bot wants to create an issue",input:{Repository:"test/review",Title:"Check the request"}})];
const engine = { id: "claude", label: "Claude", kind: "cli", installed: true, signed_in: true, available: true, version: "test", models: [], default_model: null, custom_models: true, capabilities: { tools: true, approvals: true, mcp: true, images: true, resume: true, computers: true } };
let count = 0;
try {
  for (const width of (process.env.AUDIT_WIDTHS ? process.env.AUDIT_WIDTHS.split(",").map(Number) : [1440, 1100, 1024, 900, 752, 721, 390, 360])) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : width === 360 ? 640 : 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.addInitScript(() => {
      // Laptop checks deliberately exercise a browser with no speech API.
      window.SpeechRecognition = undefined;
      window.webkitSpeechRecognition = undefined;
      if (!sessionStorage.getItem("test-browser-speech")) return;
      window.webkitSpeechRecognition = class {
        start() { window.activeBrowserSpeech = this; }
        result(text, final = false) {
          this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: final })] });
        }
        stop() {
          setTimeout(() => {
            if (!window.silentBrowserSpeech) this.result("Final browser words", true);
            this.onend?.();
          }, 100);
        }
        abort() { window.browserSpeechAborted = true; }
      };
    });
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    const payloads = [];
    const voiceLanguages = [];
    const voiceBodies = [];
    let liveVoice = false;
    let voiceFailure = false;
    let aliases = [];
    let drafts = [];
    let draftError = false;
    let dayError = false;
    let dayRoutines = [];
    let dayReminders = [];
    let dayPrefs = { timezone: "UTC", quiet_enabled: false, location: "", israel: false };
    let phoneStatus = { state: "ready", message: "Ready to make a private link to this app.", address: "" };
    let phoneError = false;
    let withComputer = false;
    let events = [...initialEvents];
    let emptyBots = false;
    let bots = [bot];
    let scope = ["admin", "chat"];
    const pairedDenied = [];
    let unread = 0;
    let auditNormal = false;
    const failedRequests = [];
    const normalRequests = [];
    page.on("response", response => { if (auditNormal && response.url().includes("/api/v1/") && response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });
    let notificationKind = "routine_completed";
    let dockerAvailable = false;
    let waitingFeed = true;
    let otherWaiting = false;
    let otherError = false;
    let otherChats = false;
    let stress = false;
    let preferenceFailure = false;
    let signedOut = false;
    let setupLead = false;
    let backendDown = false;
    const computer = { id: 7, agent_id: 1, kind: "desktop", provider: "docker", name: "Review computer", image: "open-dots-desktop:local", image_id: "fixture-image", workspace_path: "/host/bots/review", guest_workspace: "/workspace", network: "none", state: "running", live_state: "running", cpus: 2, memory_mb: 2048, pids_limit: 256, idle_minutes: 30, busy: false, health: { available: true }, last_command: null };
    page.on("pageerror", e => { errors.push(e.message); console.error("Page error:", e.message); });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith("/api/v1/")) return route.continue();
      if ((url.origin !== origin && url.hostname !== "localhost") || !url.pathname.startsWith("/api/v1/")) return route.abort();
      const path = url.pathname.slice(7);
      if (!scope.includes("admin") && !(/^\/(auth\/(status|session)|local\/(status|sandbox)|version|engines|providers|agents(?:\/\d+)?|team(?:\/jobs(?:\/\d+)?)?|rooms(?:\/\d+(?:\/(messages|read|stop|approvals|export))?)?|threads(?:\/\d+(?:\/(events(?:\/stream)?|approvals))?)?)$/.test(path))) {
        pairedDenied.push(path);
        return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "Do this from your computer" }) });
      }
      if (auditNormal) normalRequests.push(path);
      if (["POST", "PUT", "DELETE"].includes(route.request().method())) { writes.push(path); payloads.push({ path, body: route.request().headers()["content-type"]?.includes("application/json") ? route.request().postDataJSON() : null }); }
      const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type,x-csrf-token,last-event-id", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (path === "/local/status" && backendDown) return route.abort("connectionrefused");
      if (path === "/notifications/preferences" && preferenceFailure && route.request().method() === "PUT") return route.fulfill({status: 503, headers, contentType: "application/json", body: JSON.stringify({detail: "Unavailable"})});
      if (path === "/auth/login") return route.fulfill({status: 401, headers, contentType: "application/json", body: JSON.stringify({detail: "That sign-in code is not correct."})});
      if (path.startsWith("/phone/")) {
        if (phoneError) return route.fulfill({ status: 503, headers, contentType: "application/json", body: JSON.stringify({ detail: "Could not reach Tailscale. Try again." }) });
        if (path === "/phone/on") phoneStatus = { state: "on", message: "Your private phone link is on.", address: "https://chief.example.ts.net:10000" };
        if (path === "/phone/off") phoneStatus = { state: "ready", message: "Ready to make a private link to this app.", address: "" };
        const body = path === "/phone/pairing-code" ? { url: "https://chief.example.ts.net:10000/pair#code=TEST-ONLY", expires_at: new Date(Date.now() + 300000).toISOString() } : phoneStatus;
        return route.fulfill({ headers, contentType: "application/json", body: JSON.stringify(body) });
      }
      if (path === "/computers/7/screenshot") return route.fulfill({ headers, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64") });
      if (path.endsWith("/approvals/long-approval") && route.request().method() === "POST") { events.push(event(events.at(-1).seq + 1, "approval.resolved", { approval_id: "long-approval", status: "allowed" })); }
      if (path.startsWith("/threads/2")) {
        if (otherError) return route.fulfill({ status: 503, headers, contentType: "application/json", body: '{}' });
        const other = { ...thread, id: 2, agent_id: 2, title: "Review another request", computer: null, active_turn_id: null, turns: [], last_seq: 0 };
        return route.fulfill({ headers, contentType: path.endsWith("/events/stream") ? "text/event-stream" : "application/json", body: path.endsWith("/events/stream") ? "" : JSON.stringify(path.endsWith("/approvals") ? otherWaiting ? [{ id: "other-approval", status: "pending" }] : [] : other) });
      }
      if (path.endsWith("/events/stream")) return route.fulfill({ headers, contentType: "text/event-stream", body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("") });
      let body;
      if (path === "/integrations/connector") return route.fulfill({ headers, contentType: "application/json", body: JSON.stringify({ providers: ["github", "gmail", "google-calendar", "hubspot", "linkedin", ...Array.from({length: 15}, (_, i) => `example${i}`)].map(service => ({service, displayName: {gmail: "Gmail", "google-calendar": "Google Calendar"}[service] ?? service, category: service === "gmail" ? "Email" : "Work", authTypes: ["api_key"], description: "Use an API key from your account settings.", actionCount: 2})), oauth: [], connections: [{ id: "contacts", service: "hubspot", connectionName: "Test contacts", status: "active" }, { id: "social", service: "linkedin", connectionName: "Test social", status: "active" }] }) });
      if (path.startsWith("/chief/contact-aliases") || path.startsWith("/chief/post-drafts")) {
        const method = route.request().method();
        const data = ["POST", "PUT"].includes(method) ? route.request().postDataJSON() : null;
        if (draftError) return route.fulfill({ status: 503, headers, contentType: "application/json", body: JSON.stringify({ detail: "Unavailable" }) });
        if (path.endsWith("contact-aliases")) { if (data) aliases = data.contacts; body = method === "GET" ? aliases : { saved: true }; }
        else if (path.endsWith("/check")) body = { lengths: { X: { characters: data.text.length, budget: 280, over_budget: false } }, link_count: 0, near_duplicates: drafts.map(d => ({ id: d.id, kind: d.kind })), privacy_alert: true, privacy_preview: "Review [private link or address]" };
        else if (method === "POST" || method === "PUT") { const id = method === "PUT" ? path.split("/").at(-1) : String(drafts.length + 1); body = { ...data, id }; drafts = [...drafts.filter(d => d.id !== id), body]; }
        else if (method === "DELETE") { drafts = drafts.filter(d => d.id !== path.split("/").at(-1)); body = { removed: true }; }
        else body = drafts;
        return route.fulfill({ headers, contentType: "application/json", body: JSON.stringify(body) });
      }
      if (path.startsWith("/chief/")) {
        const method = route.request().method();
        const data = method === "POST" || method === "PUT" ? route.request().postDataJSON() : null;
        if (dayError) return route.fulfill({ status: 503, headers, contentType: "application/json", body: JSON.stringify({ detail: "Day settings temporarily unavailable." }) });
        if (path === "/chief/starter-team") body = { created: ["Inbox", "Calendar", "Research", "Builder"], kept: [], message: "Team ready" };
        else if (path === "/chief/preferences") { if (data) dayPrefs = data; body = dayPrefs; }
        else if (path === "/chief/routines" && method === "POST") { dayRoutines = ["Morning brief", "Evening brief", "Gmail triage"].map((name, index) => ({ id: index + 1, name, agent_id: 1, enabled: false, time: "09:00", kind: ["morning", "evening", "inbox"][index] })); body = { ids: [1,2,3] }; }
        else if (path === "/chief/routines") body = dayRoutines;
        else if (path.startsWith("/chief/routines/")) { dayRoutines = dayRoutines.map(r => r.id === Number(path.split("/").at(-1)) ? { ...r, ...data } : r); body = { saved: true }; }
        else if (path === "/chief/reminders" && method === "POST") {
          if (data.text === "remind me tomorrow to call") body = { question: "What date and time should I remind you?" };
          else { dayReminders = [{ id: "test-reminder", body: "לקבוע תור לרופא שיניים", time_label: "2026-11-04 09:00 UTC", status: "pending" }]; body = dayReminders[0]; }
        } else if (path === "/chief/reminders") body = dayReminders;
        else { dayReminders = []; body = { status: "cancelled" }; }
        return route.fulfill({ headers, contentType: "application/json", body: JSON.stringify(body) });
      }
      if (path === "/agents/1/computer" && route.request().method() === "POST") { withComputer = true; body = computer; }
      else if (path === "/threads" && route.request().method() === "POST") body = thread;
      else if (path === "/threads/1/turns" && route.request().method() === "POST") body = { id: 2, status: "running" };
      else if (path === "/voice/transcribe") {
        voiceLanguages.push(url.searchParams.get("language"));
        const audio = route.request().postDataBuffer().toString();
        voiceBodies.push(audio);
        const final = audio.endsWith("fixture-final");
        if (liveVoice && final && voiceFailure) return route.fulfill({ status: 503, headers, contentType: "application/json", body: JSON.stringify({ detail: "Preparing voice model, try again in a minute" }) });
        body = { text: liveVoice ? final ? "Final voice words" : "Live voice draft" : "Recorded draft" };
      }
      else if (path === "/auth/status") body = { desktop: false, configured: true, owner_configured: true, signed_in: !signedOut && !new URL(page.url()).pathname.startsWith("/login") };
      else if (path === "/auth/session") body = { kind: "browser", scopes: scope, csrf_token: "fixture-only", user_id: null };
      else if (path === "/onboarding/detect") body = { version: 1, status: "configured", auto_created: false, ready_choices: [{ provider: "claude", label: "Claude", model: null }], draft: { step: 0, provider: "claude", model: null, name: "Chief", purpose: "Help", first_request: "Hello", create_agent: true, make_lead: false }, agent_id: 1, execution_host: "server", existing_agents: true };
      else if (path === "/templates") body = {version: 1, categories: ["everyday"], templates: [{id: "helper", name: "Everyday helper", role: "Helper", category: "everyday", description: "Help with daily work", instructions: "Ask before acting.", color: "blue", example_requests: ["Help me plan today"], requires: [], available: true, starter_notes: null, skills: []}]};
      else if (path === "/memory/settings") body = {helper_models: {}, tidy_hour: 3, learn_from_rooms: false};
      else if (path === "/agents/1/memory/upkeep") body = {enabled: false, engine_can_call: true, engine: "claude", quiet_seconds: 60, last_capture: null, last_tidy: null, tidy_hour: 3};
      else if (path === "/memory/about-me") body = {text: "", hash: "empty", learned: [], max_chars: 10000};
      else if (path === "/agents/1/memory") body = {path: "/host/private/bots/review/MEMORY.md", text: "", hash: "empty", lines: 0, bytes: 0, loaded_lines: 0, loaded_bytes: 0, truncated: false, max_lines: 200, max_bytes: 10000, enabled: true, redacted: 0};
      else if (path === "/agents/1/memory/topics") body = {topics: [], max_topics: 20, max_bytes: 10000, folder: "/host/private/bots/review/memory"};
      else if (["/agents/1/memory/proposals", "/agents/1/memory/journal"].includes(path)) body = [];
      else if (path === "/profile") body = { name: "You", email: null, avatar_url: null, bio: null, is_admin: true };
      else if (path === "/usage/annual") body = { days: [], tokens: 0, messages: 0, cost: null, activeDays: 0, peak: null, currentStreak: 0, longestStreak: 0, providers: [], models: [], teammates: [] };
      else if (["/auth/devices", "/approval-rules", "/integrations/marketplace/connections"].includes(path)) body = [];
      else if (path === "/integrations/marketplace") body = { tested: [], community: [] };
      else if (path === "/telegram") body = { enabled: false, lead_agent: null };
      else if (path === "/onboarding") body = { version: 1, status: "configured", auto_created: true, ready_choices: [{ provider: "claude", label: "Claude", model: null }], draft: { step: 0, provider: "claude", model: null, name: "Chief", purpose: "Help", first_request: "Hello", create_agent: true, make_lead: false }, agent_id: 1, execution_host: "server", existing_agents: true };
      else if (path === "/local/status") body = { enabled: true, available: true, tools_enabled: true, voice: { languages: ["he", "en"], default: "auto", browser_speech: true } };
      else if (path === "/local/sandbox") body = { protected: true };
      else if (path === "/engines") body = [engine];
      else if (path === "/agents" && route.request().method() === "POST") { body = { ...bot, ...route.request().postDataJSON(), id: 100 }; bots.push(body); }
      else if (/^\/agents\/\d+$/.test(path) && route.request().method() === "DELETE") { bots = bots.filter(agent => agent.id !== Number(path.split("/").at(-1))); body = {}; }
      else if (path === "/integrations/composio/catalog") body = { source: "starter", complete: true, stale: false, error: null, total: 0, apps: [], categories: [], next_cursor: null };
      else if (path === "/integrations/composio") body = { configured: false };
      else if (path === "/integrations/composio/accounts") body = [];
      else if (path === "/agents") body = emptyBots ? [] : bots;
      else if (path === "/agents/1") body = bot;
      else if (stress && path === "/threads") body = Array.from({length: 500}, (_, i) => ({...thread, id: i + 1, agent_id: i % 100 + 1, title: `Long conversation ${i + 1}`}));
      else if (path === "/threads") body = [{ ...thread, computer: withComputer ? computer : null }, ...(otherChats ? [{ ...thread, id: 2, agent_id: 2, title: "Review another request", computer: null }] : [])];
      else if (path === "/threads/1") body = { ...thread, computer: withComputer ? computer : null };
      else if (path === "/threads/1/approvals") body = waitingFeed ? [{ id: "test-approval", status: "pending" }] : [];
      else if (path === "/computers") body = withComputer ? [computer] : [];
      else if (withComputer && ["/agents/1/computer", "/computers/7"].includes(path)) body = computer;
      else if (["/agents/1/computer", "/agents/2/computer"].includes(path)) return route.fulfill({ status: 404, headers, contentType: "application/json", body: JSON.stringify({ detail: { error_code: "no_computer", message: "No computer" } }) });
      else if (path === "/computers/health") body = { available: dockerAvailable, error: dockerAvailable ? null : "Docker is not available in this test." };
      else if (path === "/planner/board") body = { id: 1, name: "Your plans", columns: [{id: 1, key: "todo", name: "To do", position: 0}, {id: 2, key: "done", name: "Done", position: 1}] };
      else if (["/planner/items", "/routines", "/team/jobs", "/team/activity"].includes(path)) body = [];
      else if (path === "/planner/routine-calendar") body = {events: [], warnings: []};
      else if (path === "/routines/preview") body = {summary: "Test schedule", next_dates: ["2026-11-06T09:00:00Z"]};
      else if (path === "/usage") {
        const total = {key: "claude/claude-opus-5-5", label: "claude/claude-opus-5-5", turns: 1, reported_turns: 1, unreported_turns: 0, input_tokens: 1234, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null};
        body = {month: url.searchParams.get("month"), total, by_engine: [total], by_thread: [], by_day: []};
      }
      else if (path === "/team" || path === "/team/lead") { if (path === "/team/lead") setupLead = true; body = {team: setupLead ? {id: 1, name: "Your team", lead_agent_id: 1} : null, agents: [], members: [], jobs: [], limits: {}, enabled: true, lead_ready: {ok: setupLead, reason: setupLead ? null : "No lead selected"}}; }
      else if (path === "/notifications/unread-count") body = { unread };
      else if (path === "/notifications/preferences") body = { desktop_enabled: false };
      else if (path === "/notifications") body = unread ? [{ id: 1, kind: notificationKind, title: notificationKind === "needs_input" ? "Computer needs your input" : "Daily review finished", body: notificationKind === "needs_input" ? "Please sign in by hand, then continue." : "Review bot finished the daily review.", thread_id: 1, read_at: null, created_at: timestamp }] : [];
      else if (/\/skills$|\/rooms$|\/notifications$/.test(path)) body = [];
      else body = {};
      return route.fulfill({ headers, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${origin}/chat?thread=1`);
    await page.locator(".approval-waiting").waitFor().catch(async error => { console.error(await page.locator("body").innerText()); throw error; });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.locator(".chat-composer textarea").evaluate(el => el.scrollHeight <= el.clientHeight + 1), "waiting placeholder is not clipped");
    assert.deepEqual(errors, [], `${width}px browser errors`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px horizontal overflow`);
    for (const selector of [".approval-allow", ".approval-deny"]) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box.height >= 44, `${width}px ${selector} height ${box.height}`);
    }
    assert.equal(await page.locator(".telegram-label").textContent(), "Telegram");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    assert.equal(await page.locator(".bot-bubble [dir=auto]:not(time)").count(), 2);
    await page.screenshot({ path: `${screenshots}control-room-${width}.png` });
    count++;
    console.log(`PASS ${width}px: no horizontal scroll, Allow/Deny >=44px, Telegram, light default, message direction`);
    const sidePanel = page.locator(".control-room > aside:not(.bot-rail)");
    const computerButton = page.getByRole("button", { name: "Computer", exact: true });
    assert.equal(await sidePanel.count(), 0);
    assert.equal(await page.locator(".other-waiting").count(), 0);
    assert.equal(await page.getByText(/Nothing waiting|Checking waiting requests/).count(), 0);
    if (width === 1440) assert.ok((await page.locator(".control-chat").boundingBox()).width >= 1100);
    const railBefore = await page.locator(".bot-rail").boundingBox();
    if (width > 720) {
      assert.equal(await computerButton.getAttribute("aria-expanded"), "false");
      await computerButton.click();
      await sidePanel.waitFor();
      assert.equal(await computerButton.getAttribute("aria-expanded"), "true");
    } else await page.locator(".computer-thumbnail").click();
    await page.getByText("Docker is not available in this test.", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${screenshots}panel-open-${width}.png` });
    const panelSurface = width > 720 ? sidePanel : page.getByRole("dialog");
    await panelSurface.getByRole("button", { name: "Close", exact: true }).click();
    await panelSurface.waitFor({ state: "hidden" });
    if (width > 720) {
      assert.equal(await computerButton.getAttribute("aria-expanded"), "false");
      assert.deepEqual(await page.locator(".bot-rail").boundingBox(), railBefore);
      await computerButton.click();
      await computerButton.click();
      assert.equal(await sidePanel.count(), 0);
    }
    count++; console.log(`PASS ${width}px absent computer uses full chat, panel opens/closes, rail stable and no overflow`);
    // Clear only this test's deliberate choice before checking the automatic default.
    await page.evaluate(() => localStorage.removeItem("od-computer-panel-1"));
    withComputer = true;
    await page.reload();
    await page.locator(".approval-waiting").waitFor();
    if (width > 720) await sidePanel.getByRole("button", { name: "Take control", exact: true }).waitFor();
    else {
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.locator(".computer-thumbnail img").waitFor();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${screenshots}running-auto-${width}.png` });
    if (width > 720) {
      if (width === 1440) {
        computer.state = computer.live_state = "stopped";
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await sidePanel.waitFor({ state: "hidden" });
        computer.state = computer.live_state = "running";
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await sidePanel.waitFor();
      }
      await sidePanel.getByRole("button", { name: "Close", exact: true }).click();
      await page.reload();
      await page.locator(".approval-waiting").waitFor();
      assert.equal(await sidePanel.count(), 0);
      assert.equal(await computerButton.getAttribute("aria-expanded"), "false");
      bots = [bot, { ...bot, id: 2, name: "Builder", pinned: false }];
      otherChats = true;
      await page.reload();
      await page.locator(".approval-waiting").waitFor();
      const rail = await page.locator(".bot-rail").boundingBox();
      await page.locator(".bot-channel").filter({ hasText: "Builder" }).click();
      await page.locator(".chat-heading h1").filter({ hasText: "Builder" }).waitFor();
      assert.equal(await sidePanel.count(), 0);
      await computerButton.click();
      await sidePanel.waitFor();
      await page.locator(".bot-channel").filter({ hasText: "Review bot" }).click();
      await page.locator(".approval-waiting").waitFor();
      assert.equal(await sidePanel.count(), 0);
      assert.deepEqual(await page.locator(".bot-rail").boundingBox(), rail);
      await page.locator(".bot-channel").filter({ hasText: "Builder" }).click();
      await sidePanel.waitFor();
      await page.reload();
      await sidePanel.waitFor();
      assert.equal(await computerButton.getAttribute("aria-expanded"), "true");
      bots = [bot]; otherChats = false;
    }
    count++; console.log(`PASS ${width}px running default, phone thumbnail, saved bot choices and no overflow`);
    withComputer = false;
    await page.evaluate(() => { localStorage.removeItem("od-computer-panel-1"); localStorage.removeItem("od-computer-panel-2"); });
    await page.goto(`${origin}/chat?thread=1`);
    if ([1440, 390].includes(width)) {
      bots = [bot, { ...bot, id: 2, name: "Builder", pinned: false }]; otherChats = true; otherWaiting = true;
      await page.reload();
      const waitingLink = page.locator(".other-waiting").getByRole("link", { name: "Waiting for you · Builder · Review another request", exact: true });
      await waitingLink.waitFor();
      assert.equal(await page.locator(".other-waiting a").count(), 1);
      assert.equal(await waitingLink.evaluate(el => getComputedStyle(el).gap), "8px");
      assert.deepEqual(await waitingLink.locator('bdi').allTextContents(), ['Builder', 'Review another request']);
      assert.equal(await sidePanel.count(), 0);
      await page.locator(".approval-allow").scrollIntoViewIfNeeded();
      assert.equal(await page.locator(".approval-allow").evaluate(button => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
      assert.ok(await page.locator(".chat-composer").evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1));
      await page.screenshot({ path: `${screenshots}waiting-strip-${width}.png` });
      await waitingLink.click();
      await page.waitForURL("**/chat?thread=2");
      await page.locator(".chat-heading h1").filter({ hasText: "Builder" }).waitFor();
      assert.equal(await page.getByRole("link", { name: "Waiting for you · Builder · Review another request", exact: true }).count(), 0);
      otherWaiting = false;
      await page.goto(`${origin}/chat?thread=1`);
      await page.locator(".approval-waiting").waitFor();
      assert.equal(await page.locator(".other-waiting").count(), 0);
      otherError = true;
      await page.reload();
      await page.locator(".waiting-check-error").waitFor();
      assert.equal(await page.locator(".other-waiting").count(), 0);
      otherError = false; otherChats = false; bots = [bot];
      await page.reload();
      await page.locator(".approval-waiting").waitFor();
      assert.equal(await page.locator(".waiting-check-error").count(), 0);
      count++; console.log(`PASS ${width}px waiting strip links to other chat, stays compact, disappears when empty, quiet check failure`);
    }
    if (width === 1440) {
      await page.evaluate(() => Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("Blocked", "SecurityError"); } }));
      // An earlier check may have left the panel open for this bot; start from closed.
      if (await computerButton.getAttribute("aria-expanded") === "true") {
        await computerButton.click();
        await sidePanel.waitFor({ state: "hidden" });
      }
      await computerButton.click();
      await sidePanel.waitFor();
      await sidePanel.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal(await computerButton.getAttribute("aria-expanded"), "false");
      assert.deepEqual(errors, []);
      await page.reload();
      await page.locator(".approval-waiting").waitFor();
      count++; console.log("PASS blocked browser storage still allows opening and closing the computer");
    }
    // The Hebrew interface mirrors the zones without moving message directions.
    await page.evaluate(() => { localStorage.setItem("od-language", "he"); });
    await page.reload();
    await page.locator(".approval-waiting").waitFor();
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px RTL horizontal overflow`);
    count++;
    console.log(`PASS ${width}px: RTL no horizontal scroll`);
    if (width > 720) {
      const hebrewComputer = page.getByRole("button", { name: "מחשב", exact: true });
      await hebrewComputer.click();
      await sidePanel.waitFor();
      assert.equal(await hebrewComputer.getAttribute("aria-expanded"), "true");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await hebrewComputer.click();
      await page.evaluate(() => localStorage.removeItem("od-computer-panel-1"));
    }
    if (width === 390) {
      await page.evaluate(() => { localStorage.setItem("od-language", "en"); localStorage.setItem("od-theme", "light"); });
      await page.reload();
      await page.locator(".approval-waiting").waitFor();
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator(".approval-allow").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${screenshots}control-room-390-light.png` });
      count++; console.log("PASS light theme on phone");
      for (const locale of ["en", "he"]) {
        await page.evaluate(locale => localStorage.setItem("od-language", locale), locale);
        await page.reload();
        const choice = page.getByRole("combobox", { name: locale === "he" ? "שפת ההקלטה" : "Voice language", exact: true });
        await choice.locator('option[value="he"]').waitFor({ state: "attached" });
        assert.deepEqual(await choice.locator("option").allTextContents(), [locale === "he" ? "אוטומטי" : "Auto", "עברית", "English"]);
        assert.equal(await choice.inputValue(), locale === "en" ? "auto" : "he");
        const selectBox = await choice.boundingBox();
        const micBox = await page.locator(".voice-recorder button").boundingBox();
        assert.ok(selectBox.height >= 44 && selectBox.width >= 44 && micBox.height >= 44 && micBox.width >= 44);
        assert.ok(locale === "he" ? micBox.x + micBox.width <= selectBox.x : selectBox.x + selectBox.width <= micBox.x);
        assert.equal(await page.locator("html").getAttribute("dir"), locale === "he" ? "rtl" : "ltr");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await choice.selectOption("he");
        await page.screenshot({ path: `${screenshots}voice-language-390-${locale}.png` });
        count++; console.log(`PASS 390px ${locale} voice language options, touch targets, direction and remembered choice`);
      }
      await page.evaluate(() => localStorage.setItem("od-language", "en"));
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.voice-recorder select')?.value === "he");
      await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("denied", "NotAllowedError"); }; });
      await page.getByRole("button", { name: "Record voice", exact: true }).click();
      await page.getByText("Microphone permission was denied.", { exact: false }).waitFor();
      count++; console.log("PASS microphone permission denial is explained");
      await page.evaluate(() => {
        window.recordingTracksStopped = 0;
        navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop: () => window.recordingTracksStopped++ }] });
        window.MediaRecorder = class {
          state = "inactive"; mimeType = "audio/webm";
          start() { this.state = "recording"; }
          stop() { this.state = "inactive"; this.ondataavailable({ data: new Blob(["fixture audio"]) }); this.onstop(); }
        };
      });
      await page.locator(".chat-composer textarea").fill("Keep my words");
      await page.getByRole("button", { name: "Record voice", exact: true }).click();
      assert.equal(await page.locator(".voice-recorder select").isDisabled(), true);
      await page.getByRole("button", { name: "Stop recording", exact: true }).click();
      await page.getByText("Added to your draft.", { exact: false }).waitFor();
      assert.equal(await page.locator(".chat-composer textarea").inputValue(), "Keep my words\nRecorded draft");
      assert.ok(await page.evaluate(() => window.recordingTracksStopped > 0));
      assert.equal(writes.some(path => /\/turns$/.test(path)), false);
      assert.deepEqual(voiceLanguages, ["he"]);
      count++; console.log("PASS voice preserves the draft, stops capture and never sends a turn");
      await page.getByRole("button", { name: "Record voice", exact: true }).click();
      const before = writes.filter(path => path === "/voice/transcribe").length;
      await page.goto(`${origin}/login`);
      assert.equal(writes.filter(path => path === "/voice/transcribe").length, before);
      count++; console.log("PASS leaving the chat discards an unfinished recording");
    }
    if ([1440, 390].includes(width)) {
      liveVoice = true;
      events = [];
      for (const action of ["send", "enter", "empty", "failure", "capture-error"]) {
        voiceFailure = action === "failure";
        await page.evaluate(() => localStorage.setItem("od-language", "en"));
        await page.goto(`${origin}/chat?agent=1`);
        const box = page.locator(".chat-composer textarea");
        const send = page.getByRole("button", { name: "Send message", exact: true });
        await box.waitFor();
        await page.evaluate(() => {
          window.recordingTracksStopped = 0;
          navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop: () => window.recordingTracksStopped++ }] });
          window.MediaRecorder = class {
            state = "inactive"; mimeType = "audio/webm";
            start(interval) {
              this.state = "recording";
              window.activeVoiceRecorder = this;
              this.ondataavailable({ data: new Blob(["fixture-header"]) });
              this.timer = setInterval(() => this.ondataavailable({ data: new Blob(["fixture-chunk"]) }), interval);
            }
            stop() {
              this.state = "inactive";
              clearInterval(this.timer);
              queueMicrotask(() => {
                this.ondataavailable({ data: new Blob(["fixture-final"]) });
                this.onstop();
              });
            }
          };
        });
        const typed = action === "empty" ? "" : "Typed before voice";
        await box.fill(typed);
        const beforeTurns = payloads.filter(p => /\/turns$/.test(p.path)).length;
        const beforeAudio = voiceBodies.length;
        const sendBefore = await send.boundingBox();
        await page.getByRole("button", { name: "Record voice", exact: true }).click();
        assert.equal(await send.isEnabled(), true);
        await page.waitForFunction(expected => document.querySelector('.chat-composer textarea')?.value === expected, typed ? `${typed}\nLive voice draft` : "Live voice draft");
        const sendDuring = await send.boundingBox();
        assert.equal(sendDuring.x, sendBefore.x);
        assert.ok(sendDuring.y >= 0 && sendDuring.y + sendDuring.height <= page.viewportSize().height);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (action === "capture-error") await page.evaluate(() => window.activeVoiceRecorder.onerror());
        else if (action === "enter") await box.press("Enter");
        else await send.click();
        if (voiceFailure || action === "capture-error") {
          await page.getByText(voiceFailure ? "Preparing voice model, try again in a minute" : "The microphone stopped unexpectedly. Try recording again.", { exact: true }).waitFor();
          assert.equal(await box.inputValue(), "Typed before voice");
          assert.equal(payloads.filter(p => /\/turns$/.test(p.path)).length, beforeTurns);
        } else {
          await page.waitForFunction(() => !document.querySelector('.chat-composer textarea')?.value);
          const turns = payloads.filter(p => /\/turns$/.test(p.path)).slice(beforeTurns);
          assert.equal(turns.length, 1);
          assert.equal(turns[0].body.prompt_text, typed ? `${typed}\nFinal voice words` : "Final voice words");
        }
        assert.ok(voiceBodies.slice(beforeAudio).every(audio => audio.startsWith("fixture-header")));
        if (action !== "capture-error") assert.ok(voiceBodies.at(-1).endsWith("fixture-final"));
        assert.equal(voiceBodies.slice(beforeAudio).filter(audio => audio.endsWith("fixture-final")).length, action === "capture-error" ? 0 : 1);
        assert.ok(await page.evaluate(() => window.recordingTracksStopped > 0));
        count++; console.log(`PASS ${width}px live voice ${action}, complete audio, final text and single-send safety`);
      }
      liveVoice = false; voiceFailure = false;
      await page.evaluate(() => sessionStorage.setItem("test-browser-speech", "1"));
      for (const action of ["send", "enter", "stop", "no-speech", "leave"]) {
        await page.goto(`${origin}/chat?agent=1`);
        const box = page.locator(".chat-composer textarea");
        const send = page.getByRole("button", { name: "Send message", exact: true });
        await page.getByRole("combobox", { name: "Voice language", exact: true }).selectOption("en");
        await box.fill("Typed before browser");
        const beforeTurns = payloads.filter(p => /\/turns$/.test(p.path)).length;
        const beforeAudio = voiceBodies.length;
        await page.getByRole("button", { name: "Record voice", exact: true }).click();
        assert.equal(await send.isEnabled(), true);
        assert.equal(await page.getByRole("note").count(), action === "send" ? 1 : 0);
        if (action === "send") {
          await page.getByRole("note").filter({ hasText: "Google in Chrome" }).waitFor();
          await page.screenshot({ path: `${screenshots}browser-speech-${width}.png` });
        }
        await page.evaluate(action => {
          const recognition = window.activeBrowserSpeech;
          if (!recognition.continuous || !recognition.interimResults || recognition.lang !== "en-US") throw Error("Speech configuration missing");
          if (action === "no-speech") window.silentBrowserSpeech = true;
          else { recognition.result("Interim"); recognition.result("Interim browser words"); }
        }, action);
        if (action !== "no-speech") await page.waitForFunction(() => document.querySelector('.chat-composer textarea')?.value === "Typed before browser\nInterim browser words");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (action === "leave") {
          await page.locator(".other-waiting a").first().click();
          await page.waitForFunction(() => window.browserSpeechAborted === true);
        } else {
          if (action === "enter") await box.press("Enter");
          else if (action === "stop") await page.getByRole("button", { name: "Stop recording", exact: true }).click();
          else await send.click();
          if (action === "stop") {
            await page.getByText("Added to your draft.", { exact: false }).waitFor();
            assert.equal(await box.inputValue(), "Typed before browser\nFinal browser words");
          } else if (action === "no-speech") {
            await page.getByText("No speech was heard. Try again or type your message.", { exact: true }).waitFor();
            assert.equal(await box.inputValue(), "Typed before browser");
          } else {
            await page.waitForFunction(() => !document.querySelector('.chat-composer textarea')?.value);
          }
        }
        const turns = payloads.filter(p => /\/turns$/.test(p.path)).slice(beforeTurns);
        assert.equal(turns.length, ["send", "enter"].includes(action) ? 1 : 0);
        if (turns.length) assert.equal(turns[0].body.prompt_text, "Typed before browser\nFinal browser words");
        assert.equal(voiceBodies.length, beforeAudio);
        count++; console.log(`PASS ${width}px browser speech ${action}, live text, privacy and single-send safety`);
      }
      await page.evaluate(() => sessionStorage.removeItem("test-browser-speech"));
      events = [...initialEvents];
      await page.goto(`${origin}/login`);
    }
    if ([1440, 1024, 390].includes(width)) {
      withComputer = true;
      await page.evaluate(() => { localStorage.setItem("od-language", "en"); localStorage.setItem("od-theme", "dark"); });
      await page.goto(`${origin}/chat?thread=1`);
      await page.locator(".approval-waiting").waitFor();
      if (width === 390) {
        await page.locator(".computer-thumbnail img").waitFor();
        await page.locator(".computer-thumbnail").click();
        await page.getByRole("dialog").waitFor();
      }
      await page.getByRole("img", { name: "Current desktop", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok(await page.getByRole("button", { name: "Take control", exact: true }).isVisible());
      await page.screenshot({ path: `${screenshots}control-room-${width}-computer.png` });
      count++; console.log(`PASS ${width}px: computer preview, Take control, phone expansion and no overflow`);
      assert.deepEqual(errors, [], `${width}px computer browser errors`);
    }
    if ([1440, 1024, 390, 360].includes(width)) {
      withComputer = true;
      unread = 1;
      computer.live_state = "stopped";
      computer.state = "stopped";
      computer.last_command = { tool: "browser_open", subject: "Browser action", exit_code: 0, output: Array.from({ length: 100 }, (_, i) => `Output line ${i}`).join("\n") };
      events = [event(1, "turn.started", { prompt_text: "Review the long conversation" })];
      for (let i = 0; i < 80; i++) events.push(event(events.length + 1, "assistant.message", { text: `Conversation entry ${i}. A longer paragraph to exercise scrolling with real wrapping and multiple lines. The computer panel also contains a long command result.` }));
      const append = (type, data) => events.push(event(events.at(-1).seq + 1, type, data));
      const input = { file_path: "/host/bots/review/src/example.txt", content: "Hello" };
      append("tool.started", { call_id: "denied-write", name: "Write", input, summary: input.file_path });
      append("approval.requested", { approval_id: "denied-write", tool: "Write", input, summary: input.file_path });
      append("approval.resolved", { approval_id: "denied-write", status: "denied" });
      append("tool.completed", { call_id: "denied-write", ok: false, output: "Denied" });
      append("tool.started", { call_id: "browser", name: "mcp__computer__browser_open", input: {}, summary: "" });
      append("tool.completed", { call_id: "browser", ok: true, output: "Opened" });
      await page.evaluate(() => { localStorage.setItem("od-language", "en"); localStorage.setItem("od-theme", "dark"); });
      await page.goto(`${origin}/chat?thread=1`);
      await page.getByText("Opened page in browser", { exact: true }).waitFor();
      const geometry = async (card = false) => {
        const result = await page.evaluate(card => {
          const composer = document.querySelector(".chat-composer").getBoundingClientRect();
          const scroller = document.querySelector(".conversation-scroller").getBoundingClientRect();
          const approval = document.querySelector(".approval-waiting")?.getBoundingClientRect();
          return { page: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth, composer: composer.top >= 0 && composer.bottom <= innerHeight + 1, card: !card || !!approval && approval.top >= scroller.top - 1 && approval.bottom <= Math.min(scroller.bottom, composer.top) + 1 };
        }, card);
        assert.deepEqual(result, { page: true, composer: true, card: true }, `${width}px geometry`);
      };
      await geometry();
      assert.equal(await page.locator(".approval-receipt").count(), 1);
      assert.equal(await page.locator(".tool-receipt").count(), 1);
      assert.doesNotMatch(await page.locator(".approval-receipt, .tool-receipt").allTextContents().then(a => a.join(" ")), /mcp__|\/host\//);
      assert.match(await page.locator(".approval-receipt").innerText(), /Denied.*src\/example.txt/);
      if (width > 720) {
        assert.equal(await sidePanel.count(), 0, "stopped computer defaults closed");
        await computerButton.click();
        await page.getByRole("button", { name: "Advanced", exact: true }).click();
        await geometry();
        assert.equal(await page.getByRole("button", { name: "Take control", exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "Build bundled desktop image", exact: true }).count(), 0);
        assert.ok(await page.locator('[aria-label="Desktop stopped"]').getByRole("button", { name: "Start", exact: true }).isVisible());
      } else {
        assert.equal(await page.locator(".chat-heading .computer-thumbnail").count(), 1);
        await page.locator(".computer-thumbnail").click();
        await page.getByRole("button", { name: "Advanced", exact: true }).click();
        assert.equal(await page.getByRole("button", { name: "Take control", exact: true }).isDisabled(), true);
        await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
        await geometry();
      }
      append("approval.requested", { approval_id: "long-approval", tool: "Write", summary: "Review bot wants to write a file", input: { file: "review.txt", content: "A line of proposed content.\n".repeat(100) } });
      await page.locator(".approval-waiting").waitFor();
      await geometry(true);
      for (const cls of [".approval-allow", ".approval-deny"]) {
        assert.equal(await page.locator(cls).evaluate(button => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, `${width}px ${cls} hit target`);
      }
      const allow = await page.locator(".approval-allow").boundingBox();
      await page.mouse.click(allow.x + allow.width / 2, allow.y + allow.height / 2);
      await page.waitForFunction(() => !document.querySelector(".approval-waiting"));
      assert.ok(writes.some(path => /long-approval.*answer|approvals.*long-approval/.test(path)), `${width}px Allow reached answer API`);
      count++; console.log(`PASS ${width}px long history: tall computer, viewport, relative receipts, merged denial, visible approval and centre click`);
      await page.locator(".conversation-scroller").evaluate(el => { el.scrollTop = 0; });
      await page.getByRole("button", { name: "Jump to latest", exact: true }).waitFor();
      append("approval.requested", { approval_id: "handoff", tool: "mcp__computer__handoff", kind: "handoff", summary: "Sign in", input: { reason: "Please sign in by hand." } });
      await page.getByRole("button", { name: "Waiting for you", exact: true }).waitFor();
      assert.ok(await page.locator(".conversation-scroller").evaluate(el => el.scrollTop < 100));
      await page.getByRole("button", { name: "Waiting for you", exact: true }).click();
      await geometry(true);
      assert.equal(await page.locator(".approval-allow").evaluate(button => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
      await page.screenshot({ path: `${screenshots}job5b-long-${width}.png` });
      if (width > 720) await sidePanel.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator(".approval-waiting .computer-preview-button").click();
      await page.getByRole("button", { name: "Take control", exact: true }).waitFor();
      await (width > 720 ? sidePanel : page.getByRole("dialog")).getByRole("button", { name: "Close", exact: true }).click();
      count++; console.log(`PASS ${width}px reading history: waiting jump preserves position and reveals whole hand-off`);
      await page.goto(`${origin}/chat`);
      await page.locator(".chat-heading h1").filter({ hasText: "Review bot" }).waitFor();
      assert.equal(await page.getByRole("option", { name: "No bot", exact: true }).count(), 0);
      assert.equal(await page.locator(".chat-heading select").count(), 0);
      assert.equal(await page.locator(".notification-badge.waiting").count(), 0);
      await page.locator('button[aria-label*="unread"]').click();
      await page.getByText("Daily review finished", { exact: true }).waitFor();
      assert.match(await page.getByRole("dialog").innerText(), /1 unread notification/);
      await page.keyboard.press("Escape");
      notificationKind = "needs_input";
      await page.reload();
      await page.locator(".notification-badge.waiting").waitFor();
      await page.locator('button[aria-label*="unread"]').click();
      await page.getByText("Please sign in by hand, then continue.", { exact: true }).waitFor();
      waitingFeed = false;
      await page.reload();
      await page.locator(".notification-badge").waitFor();
      assert.equal(await page.locator(".notification-badge.waiting").count(), 0);
      await page.locator('button[aria-label*="unread"]').click();
      await page.getByText("No longer waiting for an answer", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.locator(".chat-composer textarea").fill("A first message");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.waitForURL("**/chat?thread=1");
      assert.equal(payloads.find(p => p.path === "/threads").body.agent_id, 1);
      await page.waitForFunction(() => document.querySelector(".approval-waiting"));
      count++; console.log(`PASS ${width}px first message has a bot; active and answered hand-off badges are distinct`);
      withComputer = false;
      dockerAvailable = true;
      await page.goto(`${origin}/chat`);
      if (width <= 720) await page.locator(".computer-thumbnail").click();
      else await computerButton.click();
      await page.getByRole("button", { name: "Set up a computer", exact: true }).click();
      await page.getByRole("button", { name: "Take control", exact: true }).waitFor();
      assert.deepEqual(payloads.find(p => p.path === "/agents/1/computer").body, { provider: "docker", kind: "desktop", network: "default", browser_enabled: true, start: true });
      if (width <= 720) {
        await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
        const fullHeight = width === 390 ? 844 : 640;
        await page.setViewportSize({ width, height: 480 });
        await page.waitForFunction(() => document.querySelector(".chat-composer").getBoundingClientRect().bottom <= innerHeight + 1);
        await geometry();
        await page.setViewportSize({ width, height: fullHeight });
      }
      count++; console.log(`PASS ${width}px one-click computer defaults and keyboard-size viewport`);
      emptyBots = true;
      await page.reload();
      await page.getByRole("button", { name: "Set up your first bot", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Send message", exact: true }).isDisabled(), true);
      count++; console.log(`PASS ${width}px default bot, no selector, neutral explained notification and first-run setup`);
      assert.deepEqual(errors, [], `${width}px long conversation browser errors`);
    }
    if ([1440, 390].includes(width)) {
      emptyBots = false;
      await page.goto(`${origin}/chat?thread=1`);
      await page.getByRole("button", { name: "Add the starter team", exact: true }).click();
      await page.getByText("Choose app access", { exact: true }).waitFor();
      assert.ok(writes.includes("/chief/starter-team"));
      assert.equal(payloads.some(p => p.path.includes("grants")), false);
      count++; console.log(`PASS ${width}px starter team action and app-grant prompt`);
      await page.goto(`${origin}/settings/day/`);
      const day = page.getByTestId("day-settings");
      await day.getByText("No pending reminders.", { exact: true }).waitFor();
      assert.equal(await day.getByLabel("Shabbat and Yom Tov quiet", { exact: true }).isChecked(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await day.getByRole("button", { name: "Add day routines", exact: true }).click();
      await day.getByRole("button", { name: "Save Morning brief", exact: true }).waitFor();
      assert.equal(await day.getByLabel("Enabled", { exact: true }).first().isChecked(), false);
      await day.getByLabel("Morning brief time", { exact: true }).fill("08:30");
      await day.getByLabel("Enabled", { exact: true }).first().check();
      await day.getByRole("button", { name: "Save Morning brief", exact: true }).click();
      await day.getByText("Morning brief saved.", { exact: true }).waitFor();
      assert.equal(dayRoutines[0].time, "08:30"); assert.equal(dayRoutines[0].enabled, true);
      await day.getByLabel("Reminder", { exact: true }).fill("remind me tomorrow to call");
      await day.getByRole("button", { name: "Create reminder", exact: true }).click();
      await day.getByRole("alert").filter({ hasText: "What date and time" }).waitFor();
      assert.equal(dayReminders.length, 0);
      await day.getByLabel("Reminder", { exact: true }).fill("תזכיר לי מחר בבוקר לקבוע תור לרופא שיניים");
      await day.getByRole("button", { name: "Create reminder", exact: true }).click();
      await day.getByText("2026-11-04 09:00 UTC", { exact: true }).waitFor();
      await day.getByRole("button", { name: "Cancel reminder", exact: true }).click();
      await day.getByText("Reminder cancelled.", { exact: true }).waitFor();
      assert.equal(dayReminders.length, 0);
      count++; console.log(`PASS ${width}px day settings empty, enable, ambiguous, Hebrew reminder and cancel`);
      dayError = true;
      await page.reload();
      await day.getByRole("alert").filter({ hasText: "temporarily unavailable" }).waitFor();
      dayError = false;
      await day.getByRole("button", { name: "Retry", exact: true }).click();
      await day.getByLabel("Time zone", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, [], `${width}px day settings browser errors`);
      count++; console.log(`PASS ${width}px day settings failure, retry and responsive layout`);
      if ([1440, 390].includes(width)) {
        await page.goto(`${origin}/settings/advanced/`);
        const contacts = page.getByTestId("contact-settings");
        await contacts.getByText("No contact aliases saved.", { exact: true }).waitFor();
        await contacts.getByLabel("Contact name", { exact: true }).fill("נועם לדוגמה");
        await contacts.getByLabel("Contact email address", { exact: true }).fill("person@example.test");
        await contacts.getByLabel("Nicknames", { exact: true }).fill("Example");
        await contacts.getByLabel("Contact account", { exact: true }).selectOption("contacts");
        await contacts.getByRole("button", { name: "Save alias", exact: true }).click();
        await contacts.getByText("Contact aliases saved.", { exact: true }).waitFor();
        await contacts.getByRole("button", { name: "Edit נועם לדוגמה", exact: true }).click();
        await contacts.getByLabel("Nicknames", { exact: true }).fill("Example, Sample");
        await contacts.getByRole("button", { name: "Save alias", exact: true }).click();
        await contacts.getByText("Example, Sample", { exact: true }).waitFor();
        assert.equal(aliases[0].address, "person@example.test");
        await contacts.getByRole("button", { name: "Remove נועם לדוגמה", exact: true }).click();
        await contacts.getByText("No contact aliases saved.", { exact: true }).waitFor();
        count++; console.log(`PASS ${width}px contact aliases: Hebrew, edit, remove and no grant mutation`);
        const posts = page.getByTestId("post-drafts");
        await posts.getByText("No drafts saved yet.", { exact: true }).waitFor();
        await posts.getByLabel("Draft text", { exact: true }).fill("Review person@example.test before sharing");
        await posts.getByRole("button", { name: "Check draft", exact: true }).click();
        await posts.getByText("Privacy warning: review addresses, links and numbers before copying.", { exact: true }).waitFor();
        await posts.getByRole("button", { name: "Save draft", exact: true }).click();
        await posts.getByText("Draft saved.", { exact: true }).waitFor();
        await posts.getByRole("button", { name: "Edit draft", exact: true }).click();
        await posts.getByLabel("Draft text", { exact: true }).fill("Edited local draft");
        await posts.getByRole("button", { name: "Save draft", exact: true }).click();
        await posts.getByText("Edited local draft", { exact: true }).first().waitFor();
        await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedDraft = text; } } }); });
        await posts.getByRole("button", { name: "Copy draft", exact: true }).click();
        await posts.getByText("Draft copied. Nothing was published.", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.copiedDraft), "Edited local draft");
        assert.equal(drafts.length, 1);
        assert.equal(writes.some(p => /publish|comment|reply/.test(p)), false);
        await page.screenshot({ path: `${screenshots}job7-drafts-${width}.png` });
        count++; console.log(`PASS ${width}px drafts: edit, privacy review, save and copy without publishing`);
        draftError = true;
        await posts.getByRole("button", { name: "Check draft", exact: true }).click();
        await posts.getByText("Draft action failed. Your text is still here; try again.", { exact: false }).waitFor();
        draftError = false;
        await posts.getByRole("button", { name: "Check draft", exact: true }).click();
        await posts.getByText("Draft checked. Nothing was published.", { exact: true }).waitFor();
        await posts.getByRole("button", { name: "Remove draft", exact: true }).click();
        await posts.getByText("No drafts saved yet.", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(errors, []);
        count++; console.log(`PASS ${width}px drafts: failure, recovery, remove and no overflow`);
        events = [event(1, "turn.started", { prompt_text: "Send the reviewed request" }), event(2, "approval.requested", { approval_id: "uncertain", tool: "mcp__composio__apps_run", input: { to: "person@example.test" }, summary: "Example Person <person@example.test>" }), event(3, "approval.resolved", { approval_id: "uncertain", status: "allowed" }), event(4, "app.action_result", { approval_id: "uncertain", outcome: "unknown" })];
        await page.goto(`${origin}/chat?thread=1`);
        await page.locator(".approval-receipt").filter({ hasText: "Outcome unknown; may have happened" }).waitFor();
        assert.equal(await page.locator(".approval-receipt .text-success").count(), 0);
        events.push(event(5, "approval.requested", { approval_id: "retry", tool: "mcp__composio__apps_run", input: { to: "person@example.test" }, summary: "Retry after UNKNOWN outcome; this may duplicate the action. Example Person <person@example.test>" }));
        await page.locator(".approval-waiting").filter({ hasText: "Retry after UNKNOWN" }).waitFor();
        await page.screenshot({ path: `${screenshots}job7-outcome-${width}.png` });
        count++; console.log(`PASS ${width}px unknown receipt and explicit retry approval`);
      }

    }
    if ([1440, 900, 390].includes(width)) {
      emptyBots = false; withComputer = false; events = [...initialEvents]; bots = [bot, { ...bot, id: 2, name: "Builder", pinned: false }];
      await page.evaluate(() => { localStorage.setItem("od-language", "en"); localStorage.removeItem("od-theme"); });
      await page.goto(`${origin}/chat?thread=1`);
      await page.locator(".approval-waiting").waitFor();
      const add = page.getByRole("button", { name: "Add bot", exact: true });
      // The bot list loads after the open chat; wait for it instead of racing it.
      await add.waitFor({ state: "visible" });
      assert.ok(await add.isVisible());
      await page.locator(".chat-heading-identity > span").waitFor({ state: "visible" });
      assert.ok(await page.locator(".chat-heading-identity > span").isVisible(), "header keeps the bot avatar on phone too");
      assert.ok((await add.boundingBox()).height >= 44);
      await page.locator(".bot-channels").evaluate(el => { el.scrollLeft = el.scrollWidth; });
      const addBox = await add.boundingBox();
      assert.ok(addBox.x >= 0 && addBox.x + addBox.width <= width, "Add bot remains outside the scrolling channels");
      if (width > 720) {
        assert.ok(await page.getByRole("button", { name: "Edit Review bot", exact: true }).isVisible());
        await page.getByRole("button", { name: "Delete Review bot", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "More", exact: true }).click();
        assert.ok(await page.getByRole("menuitem", { name: /Edit bot.*Review bot/ }).isVisible());
        await page.getByRole("menuitem", { name: /Delete bot.*Review bot/ }).click();
      }
      const permanent = page.getByRole("button", { name: "Delete permanently", exact: true });
      await permanent.waitFor();
      for (const name of ["Keep bot", "Delete permanently"]) {
        const action = page.getByRole("button", { name, exact: true });
        const box = await action.boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height, `${width}px ${name} visible without manual scrolling`);
      }
      await page.screenshot({ path: `${screenshots}delete-${width}.png` });
      await permanent.click();
      await page.waitForURL(/agent=2/);
      await page.locator(".chat-heading h1").filter({ hasText: "Builder" }).waitFor();
      assert.equal(await page.locator(".bot-channel").filter({ hasText: "Review bot" }).count(), 0);
      assert.equal(writes.filter(path => path === "/agents/1").length, 1);
      assert.equal(await page.getByText("No bot", { exact: true }).count(), 0);
      count++; console.log(`PASS ${width}px visible Add/Edit/Delete, existing confirmation, deletion selects another bot`);
      await add.click();
      await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("New helper");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.locator(".chat-heading h1").filter({ hasText: "New helper" }).waitFor();
      await page.locator(".bot-channel").filter({ hasText: "New helper" }).waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0);
      const beforeTurns = writes.filter(path => /\/turns$/.test(path)).length;
      for (const text of ["Remind me in an hour to...", "Read this PDF and sign it...", "Ask Builder to look into..."]) {
        await page.getByRole("button", { name: text, exact: true }).click();
        assert.equal(await page.locator(".chat-composer textarea").inputValue(), text);
      }
      assert.equal(writes.filter(path => /\/turns$/.test(path)).length, beforeTurns);
      assert.match(await page.locator("#conversation").innerText(), /Good (morning|afternoon|evening)\. What should New helper do\?/);
      count++; console.log(`PASS ${width}px creation opens the new bot; greeting and all starters fill without sending`);
      bots = [bot, ...["Inbox", "Calendar", "Research", "Builder"].map((name, index) => ({ ...bot, id: index + 2, name }))];
      await page.goto(`${origin}/chat?thread=1`);
      await page.locator(".approval-waiting").waitFor();
      assert.equal(await page.getByRole("button", { name: "Add the starter team", exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const noMotion = await page.evaluate(() => [...document.querySelectorAll(".bot-channel, .channel-avatar, .channel-light, .message-bubble, .approval-waiting, button")].every(el => [null, "::before", "::after"].every(pseudo => { const style = getComputedStyle(el, pseudo); return style.animationName === "none" && style.transitionDuration.split(", ").every(value => parseFloat(value) === 0); })));
      assert.ok(noMotion, "reduced motion stops animations and transitions including pseudo-elements");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      assert.equal(await page.locator(".channel-light.waiting").first().evaluate(el => getComputedStyle(el).animationName), "working-pulse");
      assert.equal(await page.locator(".approval-waiting").first().evaluate(el => getComputedStyle(el).animationDuration), "0.2s");
      await page.emulateMedia({ reducedMotion: "reduce" });
      count++; console.log(`PASS ${width}px starter team hidden, state motion and reduced-motion override, no page overflow`);
      events = [event(1, "turn.started", { prompt_text: "Working on the request" })]; waitingFeed = false;
      await page.reload();
      await page.locator(".channel-avatar.working").waitFor();
      assert.equal(await page.locator(".channel-avatar.working").evaluate(el => getComputedStyle(el, "::after").animationName), "none");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      assert.equal(await page.locator(".channel-avatar.working").evaluate(el => getComputedStyle(el, "::after").animationName), "working-pulse");
      await page.getByRole("status", { name: "Thinking", exact: true }).waitFor();
      await page.emulateMedia({ reducedMotion: "reduce" });
      scope = ["chat"];
      await page.reload();
      await page.locator(".chat-heading h1").waitFor();
      assert.equal(await page.getByRole("button", { name: "Edit Review bot", exact: true }).count(), 0);
      await page.getByRole("button", { name: "More", exact: true }).click();
      assert.equal(await page.getByRole("menuitem", { name: /Edit bot.*Review bot/ }).count(), 0);
      assert.equal(await page.getByRole("menuitem", { name: /Delete bot.*Review bot/ }).count(), 0);
      await page.keyboard.press("Escape");
      if (width === 390) {
        assert.equal(await page.getByRole("button", { name: "Add bot", exact: true }).count(), 0);
        emptyBots = true;
        await page.goto(`${origin}/chat`);
        await page.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menuitem", { name: "All chats and tools", exact: true }).click();
        await page.getByRole("dialog").waitFor();
        assert.equal(await page.getByRole("button", { name: /^(Create a bot|Add bot|Manage bots)$/ }).count(), 0);
        await page.keyboard.press("Escape");
        emptyBots = false;
        count++; console.log("PASS 390px paired empty workspace hides bot creation in the tools drawer");
        for (const target of ["apps", "settings", "settings/phone", "settings/day", "settings/account", "settings/engines", "settings/approvals", "settings/notifications", "settings/channels", "settings/profile", "settings/advanced", "marketplace", "onboarding", "chat?view=routines", "chat?view=agents", "chat?view=planner"]) {
          await page.goto(`${origin}/${target}`);
          await page.getByRole("heading", { name: "Do this from your computer", exact: true }).waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.equal(await page.getByRole("button", { name: /^(Add bot|Save|Delete bot)$/ }).count(), 0);
        }
        assert.deepEqual(pairedDenied, [], "paired pages never request owner-only data");
        count++; console.log("PASS 390px paired chat hides bot controls and guards Apps, Settings and routines");
      }
      scope = ["admin", "chat"]; events = [...initialEvents]; waitingFeed = true;
      await page.goto(`${origin}/chat?thread=1`);
      await page.locator(".approval-waiting").waitFor();
      count++; console.log(`PASS ${width}px real working ring and chat indicator; edit follows admin scope`);

      if ([1440, 390].includes(width)) {
        await page.screenshot({ path: `${screenshots}chat-${width}.png` });
        for (const route of ["settings", "apps", "login"]) {
          await page.goto(`${origin}/${route}`);
          if (route === "settings") await page.getByRole("heading", { name: "General", exact: true }).waitFor();
          if (route === "apps") await page.getByRole("heading", { name: "Apps", exact: true }).first().waitFor();
          if (route === "login") {
            await page.getByLabel("Sign-in code", { exact: true }).waitFor();
            assert.equal(await page.locator(".min-h-dvh").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
          }
          await page.evaluate(() => document.fonts.ready);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} ${width}px overflow`);
          await page.screenshot({ path: `${screenshots}${route}-${width}.png` });
        }
        assert.deepEqual(errors, [], `${width}px management and page browser errors`);
        count++; console.log(`PASS ${width}px white chat, Settings, Apps and Login screenshots, no overflow or browser errors`);
      }
    }
    if ([1440, 390].includes(width)) {
      scope = ["admin", "chat"];
      for (const status of [
        { state: "not_installed", message: "Tailscale is a free private link between your own devices." },
        { state: "signed_out", message: "Open Tailscale on this computer and sign in, then check again." },
        { state: "ready", message: "Ready to make a private link to this app." },
        { state: "on", message: "Your private phone link is on.", address: "https://chief.example.ts.net:10000" },
        { state: "failed", message: "Permission denied. Open Tailscale on this computer." },
        { state: "failed", message: "All three private HTTPS ports are in use by other services." },
        { state: "failed", message: "Turn on HTTPS certificates in Tailscale, then check again.", help_url: "https://login.tailscale.com/admin/dns" },
        { state: "unavailable", message: "Use the installed website to set up your phone. This separate development frontend cannot make a working phone link." },
      ]) {
        phoneStatus = { address: "", account: "GitHub account example-user", other_devices: 0, online_devices: 0, ...status };
        await page.goto(`${origin}/settings/phone/`);
        await page.getByText(status.message, { exact: true }).waitFor();
        assert.equal(await page.locator("ol > li").count(), status.state === "unavailable" ? 0 : 3);
        if (status.state === "on") {
          assert.equal(await page.getByTestId("phone-address").getAttribute("href"), status.address);
          await page.getByText("No phone has joined yet. On the phone, install Tailscale, sign in with GitHub account example-user, and turn it on.", { exact: true }).waitFor();
          await page.getByText("Other devices joined: 0. Online: 0.", { exact: true }).waitFor();
          for (const text of ["Can’t open the link?", "The Tailscale app on your phone should show Connected.", "Use the same account on your phone and computer.", "On Android, check that the VPN key icon is on.", "Try again after a minute."]) await page.getByText(text, { exact: true }).waitFor();
          await page.getByRole("button", { name: "Show sign-in code" }).click();
          await page.getByTestId("phone-qr").waitFor();
          assert.equal(await page.locator('img[src*="qr"]').count(), 0);
          await page.getByRole("button", { name: "Turn off", exact: true }).click();
          await page.getByRole("button", { name: "Turn on", exact: true }).waitFor();
          assert.equal(await page.getByTestId("phone-qr").count(), 0);
        }
        if (status.help_url) assert.equal(await page.getByRole("link", { name: "Open Tailscale HTTPS settings" }).getAttribute("href"), status.help_url);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `phone ${width}px ${status.state} overflow`);
        await page.screenshot({ path: `${screenshots}phone-${width}-${status.state}.png` });
        count++; console.log(`PASS ${width}px phone ${status.state}, three steps and no overflow`);
      }
      if (width === 390) {
        phoneStatus = { state: "on", message: "Your private phone link is on.", address: "https://chief.example.ts.net", account: "GitHub account example-user", other_devices: 0, online_devices: 0 };
        await page.evaluate(() => localStorage.setItem("od-language", "he"));
        await page.goto(`${origin}/settings/phone/`);
        await page.getByText("אף טלפון עדיין לא הצטרף.", { exact: false }).waitFor();
        await page.getByText("לא מצליחים לפתוח את הקישור?", { exact: true }).waitFor();
        await page.getByText("ב־Android, בדקו שסמל מפתח ה־VPN מופיע.", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.evaluate(() => localStorage.setItem("od-language", "en"));
        count++; console.log("PASS 390px Hebrew phone account guidance and link help");
      }
      phoneError = true;
      await page.goto(`${origin}/settings/phone/`);
      await page.getByText("Could not reach Tailscale. Try again.", { exact: true }).waitFor();
      phoneError = false; phoneStatus = { state: "ready", message: "Ready to make a private link to this app.", address: "" };
      await page.getByRole("button", { name: "Check again" }).click();
      await page.getByRole("button", { name: "Turn on", exact: true }).click();
      await page.getByRole("button", { name: "Turn off", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      count++; console.log(`PASS ${width}px phone retry and turn on`);
    }
    if ([1440, 900, 390, 360].includes(width)) {
      otherError = false; phoneError = false; dayError = false; draftError = false;
      await page.evaluate(() => { localStorage.setItem("od-language", "en"); localStorage.setItem("od-theme", "light"); });
      stress = true; emptyBots = false; withComputer = false; scope = ["admin", "chat"];
      bots = Array.from({length: 100}, (_, i) => ({...bot, id: i + 1, name: i === 0 ? "Review bot" : `Very long bot name ${i + 1}`}));
      events = [event(1, "turn.started", {prompt_text: "Long content"}), event(2, "assistant.message", {text: "x".repeat(1000) + "\n\n```text\n" + "wide ".repeat(100) + "\n```\n\n|" + Array(12).fill("Column").join("|") + "|\n|" + Array(12).fill("---").join("|") + "|\n|" + Array(12).fill("Long cell content").join("|") + "|"})];
      await page.goto(`${origin}/chat?thread=1`);
      await page.locator(".bot-bubble table").waitFor();
      await page.waitForFunction(() => document.querySelectorAll(".bot-channel").length === 100);
      assert.equal(await page.locator(".bot-channel").count(), 100);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "100 bots, 500 chats, unbroken text, code and wide table stay inside the page");
      assert.ok(await page.locator(".chat-composer").evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1));
      const beforePicker = await page.locator(".chat-composer textarea").inputValue();
      await page.getByRole("button", {name: "Choose an app", exact: true}).click();
      await page.locator(".app-picker").waitFor();
      assert.equal(await page.locator(".chat-composer textarea").inputValue(), beforePicker);
      const popup = await page.locator(".app-picker").boundingBox();
      const microphone = await page.locator(".voice-recorder button").boundingBox();
      assert.ok(popup.y + popup.height <= microphone.y, "app picker sits clear of microphone and composer");
      const target = await page.locator(".app-mention").boundingBox();
      assert.ok(target.height >= (width < 721 ? 44 : 24));
      await page.locator(".app-picker").getByRole("button", {name: "Close", exact: true}).click();
      await page.locator(".chat-composer textarea").fill("@app");
      await page.locator(".app-picker").waitFor();
      await page.locator(".app-picker").getByRole("button", {name: "Close", exact: true}).click();
      await page.locator(".app-picker").waitFor({state: "hidden"});
      assert.equal(await page.locator(".chat-composer textarea").inputValue(), "@app");
      await page.locator(".chat-composer textarea").fill("");
      await page.locator('.chat-composer input[type="file"]').setInputFiles({name: "too-big.txt", mimeType: "text/plain", buffer: Buffer.alloc(1024 * 1024 + 1, 65)});
      await page.getByText("too-big.txt is over the 1 MB text file limit.", {exact: true}).waitFor();
      await page.locator('.chat-composer input[type="file"]').setInputFiles({name: "wrong.exe", mimeType: "application/octet-stream", buffer: Buffer.from("not a supported attachment")});
      await page.getByText(/wrong.exe can't be attached/).waitFor();
      count++; console.log(`PASS ${width}px stress content and app picker placement with 100 bots and 500 chats`);
      stress = false; bots = [bot]; events = [...initialEvents];
      await page.goto(`${origin}/chat?thread=1&view=planner`);
      await page.getByRole("button", {name: "New task", exact: true}).click();
      await page.getByRole("dialog").last().getByLabel("Title", {exact: true}).fill("Plan next week");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "planner task form fits");
      await page.getByRole("dialog").last().getByRole("button", {name: "Cancel", exact: true}).click();
      await page.goto(`${origin}/chat?thread=1&view=routines`);
      await page.getByRole("button", {name: "New routine", exact: true}).click();
      await page.getByLabel("Routine name", {exact: true}).fill("Daily check");
      await page.getByLabel("Prompt", {exact: true}).fill("Check my daily plan");
      for (const kind of ["On chosen days at a time", "Every few minutes or hours", "Cron expression (advanced)", "Once, at a date and time", "Only by hand or webhook"]) {
        await page.getByLabel("Schedule kind", {exact: true}).click();
        await page.getByRole("menuitem", {name: kind, exact: true}).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `routine ${kind} fields fit`);
      }
      await page.getByText("Limits and approvals", {exact: true}).click();
      for (const label of ["Run limit (minutes)", "Approval wait (minutes)", "May start late by (minutes)", "Retries after a failure", "Retry after (minutes)"]) assert.ok(await page.getByLabel(label, {exact: true}).isVisible());
      await page.getByRole("button", {name: "Cancel", exact: true}).click();
      await page.goto(`${origin}/chat?thread=1&view=agents`);
      await page.getByRole("button", {name: "Templates…", exact: true}).click();
      await page.getByLabel("Search templates", {exact: true}).fill("Everyday");
      await page.getByText("Everyday helper", {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "templates fit");
      await page.goto(`${origin}/chat?thread=1&view=agents`);
      await page.getByRole("button", {name: "Migrate…", exact: true}).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "migration choices fit");
      await page.goto(`${origin}/chat?thread=1&view=agents`);
      await page.getByRole("button", {name: "Notes", exact: true}).click();
      await page.getByLabel("Notes", {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "notes fit");
      assert.ok(!(await page.getByRole("dialog").innerText()).includes("/host/private"), "notes keep host paths out of normal copy");
      count++; console.log(`PASS ${width}px planner editor, every routine schedule, advanced limits, templates, migration and notes`);
      await page.goto(`${origin}/apps/`);
      const appCatalog = page.locator('section[aria-label="Self-hosted connected apps"]');
      await appCatalog.getByLabel("Search apps", {exact: true}).waitFor();
      assert.deepEqual(await page.locator('section[aria-label="Self-hosted connected apps"] [data-app-row] h3').allTextContents(), ["Gmail", "Google Calendar", "github", ...Array.from({length: 15}, (_, i) => `example${i}`).sort().slice(0, 9)]);
      await appCatalog.getByLabel("Search apps", {exact: true}).fill("Gmail");
      await page.getByRole("button", {name: "Connect", exact: true}).click();
      await page.getByRole("heading", {name: "Connect Gmail", exact: true}).waitFor();
      assert.ok(await page.getByLabel("Account name", {exact: true}).evaluate(el => el === document.activeElement), "connection form receives focus");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "provider setup fits");
      await page.getByRole("button", {name: "Cancel", exact: true}).click();
      count++; console.log(`PASS ${width}px mainstream app ordering, search and visible connection form`);
      await page.goto(`${origin}/chat?thread=1&view=agents`);
      await page.locator("summary").filter({hasText: "Create by chatting"}).click();
      await page.getByLabel("Choose setup lead", {exact: true}).click();
      await page.getByRole("menuitem", {name: "Review bot", exact: true}).click();
      await page.getByRole("button", {name: "Make selected bot lead", exact: true}).click();
      const turnsBeforeSetup = writes.filter(path => path.endsWith("/turns")).length;
      await page.getByRole("button", {name: "Chat with Review bot", exact: true}).click();
      await page.getByRole("dialog").waitFor({state: "hidden"});
      assert.match(await page.locator(".chat-composer textarea").inputValue(), /create a bot/i);
      assert.equal(writes.filter(path => path.endsWith("/turns")).length, turnsBeforeSetup, "create by chatting opens a draft without sending");
      await page.getByRole("button", {name: "More", exact: true}).click();
      await page.getByRole("menuitem", {name: "All chats and tools", exact: true}).click();
      await page.getByRole("button", {name: "Team & Rooms", exact: true}).click();
      await page.getByRole("button", {name: /Let bots work together/}).click();
      await page.getByRole("dialog").getByRole("button", {name: "Rooms", exact: true}).click();
      await page.getByText("No rooms yet.", {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "team and rooms fit");
      count++; console.log(`PASS ${width}px create by chatting opens a draft; team and rooms are usable`);
      auditNormal = true;
      for (const [theme, language] of [["light", "en"], ["dark", "en"], ["light", "he"]]) {
        await page.evaluate(([theme, language]) => { localStorage.setItem("od-theme", theme); localStorage.setItem("od-language", language); }, [theme, language]);
        for (const route of ["settings", "settings/day", "settings/advanced", "settings/notifications", "settings/engines", "settings/account", "settings/profile", "settings/channels", "settings/approvals", "settings/phone", "apps", "marketplace", "onboarding", "pair", "login", "tasks", "chat/?thread=1&view=planner", "chat/?thread=1&view=routines", "chat/?thread=1&view=agents", "chat/?thread=1&panel=skills", "chat/?thread=1&panel=usage", "chat/?room=new", "", "offline.html"]) {
          await page.goto(`${origin}/${route}${!route || route.includes("?") || route.endsWith(".html") ? "" : "/"}`);
          await page.waitForLoadState("networkidle");
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px ${theme} ${language} ${route} overflow`);
          assert.deepEqual(errors, [], `${width}px ${route} page errors`);
          assert.deepEqual(failedRequests, [], `${width}px ${route} failing requests`);
          assert.ok(!normalRequests.some(path => ["/settings", "/desktop-account/status", "/computers/boat-credentials", "/integrations/composio/accounts"].includes(path)), "normal pages avoid inapplicable requests");
          if (route.endsWith("panel=usage")) {
            await page.getByText("Claude Opus 5.5", {exact: true}).waitFor();
            const headings = await page.locator("thead th").evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return {x: box.x, width: box.width}; }));
            assert.ok(headings.every((box, index) => index === 0 || box.x >= headings[index - 1].x + headings[index - 1].width - 1) || language === "he", "usage headers have separate columns");
          }
          if (route.startsWith("settings")) assert.equal(await page.locator('nav[aria-label="Settings"]:visible, nav[aria-label="הגדרות"]:visible').count(), 1, `${route} ${language}: ${await page.locator('nav').evaluateAll(nodes => nodes.map(n => [n.getAttribute('aria-label'), n.className, getComputedStyle(n).display, n.getBoundingClientRect().width]))}`);
          count++;
        }
      }
      console.log(`PASS ${width}px all normal routes, light/dark/Hebrew: no page errors, failing requests or horizontal scroll`);
      auditNormal = false;
      await page.evaluate(() => { localStorage.setItem("od-theme", "light"); localStorage.setItem("od-language", "en"); });
      backendDown = true;
      await page.goto(`${origin}/chat?thread=1`);
      await page.getByRole("heading", {name: "Your computer is out of reach", exact: true}).waitFor();
      backendDown = false;
      await page.getByRole("button", {name: "Try again", exact: true}).click();
      await page.locator(".chat-composer textarea").waitFor();
      preferenceFailure = true;
      await page.goto(`${origin}/settings/notifications/`);
      const enabled = page.getByRole("switch", {name: /Enable desktop notifications/});
      await page.locator("label").filter({has: enabled}).click();
      await page.getByRole("alert").filter({hasText: "Could not save notification settings"}).waitFor();
      assert.equal(await enabled.isChecked(), false, "failed save restores the previous setting");
      preferenceFailure = false;
      signedOut = true;
      normalRequests.length = 0; auditNormal = true;
      await page.goto(`${origin}/settings/`);
      await page.waitForURL(url => url.pathname.replace(/\/$/, "") === "/login");
      await page.getByLabel("Sign-in code", {exact: true}).waitFor();
      assert.ok(!normalRequests.includes("/auth/session"), "expired session redirects without requesting a failing session endpoint");
      auditNormal = false;
      await page.getByLabel("Sign-in code", {exact: true}).fill("wrong-install-code");
      await page.getByRole("button", {name: "Sign in", exact: true}).click();
      await page.getByText("That sign-in code is not correct.", {exact: true}).waitFor();
      signedOut = false;
      count++; console.log(`PASS ${width}px failed notification save, expired session and wrong sign-in code`);
    }
    await page.goto(`${origin}/missing-control-room-page`);
    await page.getByRole("heading", { name: "This page is not here" }).waitFor();
    assert.match(await page.title(), /Page not found/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    count++; console.log(`PASS ${width}px: branded 404 with page title and no overflow`);
    await context.close();
  }
  console.log(`${count} browser checks passed, 0 failed`);
} finally { await browser.close(); }
