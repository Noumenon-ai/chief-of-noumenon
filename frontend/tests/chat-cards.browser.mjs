// All API/provider traffic is intercepted. No accounts or engines are used.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const screenshots = new URL('../.next/owner-review/', import.meta.url).pathname;
await mkdir(screenshots, { recursive: true });
import { chromium } from '../../desktop/node_modules/playwright/index.mjs';
const origin = process.env.CONTROL_ROOM_URL || 'http://127.0.0.1:3935';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-background-networking'] });
const stamp = '2026-11-04T12:00:00Z';
const bot = { id: 1, name: 'Chief', provider: 'claude', archived_at: null, approval_mode: 'ask', memory_enabled: false, workspace_path: '/fixture', instructions: '', created_at: stamp, updated_at: stamp };
const thread = { id: 1, agent_id: 1, title: 'Cards', provider: 'claude', session_state: 'active', last_seq: 1, archived_at: null, created_at: stamp, updated_at: stamp, active_turn_id: null, turns: [], computer: null };
const cardId = 'a'.repeat(32), attack = '<img src=x onerror=alert(1)> [link](https://evil.test)';
let count = 0;
try {
  for (const width of [1440, 390]) for (const language of ['en', 'he']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addInitScript(language => localStorage.setItem('od-language', language), language);
    const page = await context.newPage();
    const logs = [], writes = [];
    let connected = false, answers = 0, grants = {}, kind = 'welcome';
    let signedIn = false, ownerConfigured = false, flowEvents = null, reminders = [];
    const connectId = 'b'.repeat(32);
    const makeEvent = (seq, type, data) => ({ seq, type, thread_id: 1, turn_id: null, ts: stamp, data });
    const inView = async locator => {
      const box = await locator.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= 900 && box.x >= 0 && box.x + box.width <= width, 'first field is in the viewport');
      assert.equal(await locator.evaluate(el => el === document.activeElement), true, 'first field is focused');
    };
    context.on('page', popup => popup.on('console', m => logs.push(m.text())));
    page.on('console', m => logs.push(m.text())); page.on('pageerror', e => logs.push(e.message));
    const event = () => kind === 'assistant' ? { seq: 1, type: 'assistant.message', thread_id: 1, turn_id: null, ts: stamp, data: { text: 'Fixture reply' } } : ({ seq: 1, type: 'chat.card', thread_id: 1, turn_id: null, ts: stamp, data: { id: cardId, kind, question: 'Choose a reply', options: [attack, 'Second choice'], name: kind === 'welcome' ? 'Chief' : 'Gmail', provider: 'gmail' } });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/v1/')) return route.continue();
      const path = url.pathname.slice(7), method = req.method();
      if (['POST','PUT','DELETE'].includes(method)) writes.push({path, body: req.postDataJSON()});
      if (path === '/history/export') return route.fulfill({ contentType: 'application/zip', headers: {'content-disposition':'attachment; filename=history.zip'}, body: Buffer.from('fixture archive') });
      let body = {};
      if (path === '/auth/status') body = { desktop: false, configured: ownerConfigured, owner_configured: ownerConfigured, setup_allowed: true, signed_in: signedIn };
      else if (path === '/auth/setup') { signedIn = true; ownerConfigured = true; body = { kind: 'browser', scopes: ['admin','chat'], csrf_token: 'fixture', user_id: null }; }
      else if (path === '/auth/session') body = { kind: 'browser', scopes: ['admin','chat'], csrf_token: 'fixture', user_id: null };
      else if (path === '/onboarding' || path === '/onboarding/detect') body = { version: 1, status: 'configured', agent_id: 1, existing_agents: true };
      else if (path === '/integrations/connector') body = {
        providers: ['gmail','googlecalendar','googledrive','github','google_analytics', ...Array.from({length:263}, (_, i) => `example${String(i).padStart(3,'0')}`)].map(service => ({ service, displayName: ({gmail:'Gmail', googlecalendar:'Google Calendar', googledrive:'Google Drive', github:'GitHub', google_analytics:'Google Analytics'})[service] || service, category: 'Productivity', authTypes: service === 'example000' ? ['no_auth'] : ['api_key', 'oauth2'], description: 'Connected apps platform with 102 actions for automated agents', actionCount: 102 })),
        oauth: ['gmail','googlecalendar','googledrive','github','google_analytics'].map(service => ({ service, configured: connected, callbackUrl: `${origin}/api/v1/integrations/connector/oauth/${service}/callback`, defaultScopes: [] })),
        connections: connected ? [{ id: 'account', service: 'gmail', connectionName: 'Personal', status: 'active' }] : []
      };
      else if (path === '/integrations/connector/oauth/gmail') { connected = true; body = { url: `${origin}/apps/?status=success` }; }
      else if (path === '/integrations/connector/grants/1') { if (method === 'PUT') grants = req.postDataJSON(); body = grants; }
      else if (path.endsWith(`/cards/${cardId}`) || path.endsWith(`/cards/${connectId}`)) {
        answers++; await new Promise(resolve => setTimeout(resolve, 100));
        if (kind === 'welcome') {
          flowEvents = [event(), makeEvent(2, 'chat.card.answered', {id:cardId, answer:'Connect Gmail'}), makeEvent(3, 'chat.card', {id:connectId, kind:'connect', name:'Gmail', provider:'gmail'})];
        }
        body = { answered: true };
      }
      else if (path === '/chief/preferences') body = {timezone:'UTC', quiet_enabled:false, location:'', israel:false};
      else if (path === '/chief/routines') body = [];
      else if (path === '/chief/reminders') {
        if (method === 'POST') reminders = [{id:'reminder', body:req.postDataJSON().text, time_label:'2026-11-05 09:00 UTC', status:'pending'}];
        body = method === 'POST' ? reminders[0] : reminders;
      }
      else if (path === '/threads/1/approvals/first-approval') body = { status:'allowed' };
      else if (path === '/integrations/marketplace') body = { tested:[], community:[] };
      else if (path === '/agents/import') { await new Promise(resolve => setTimeout(resolve, 100)); body = { ...bot, id: 2, name: 'Imported helper' }; }
      else if (path === '/threads/1/turns') { await new Promise(resolve => setTimeout(resolve, 100)); body = { id: 2, status: 'running' }; }
      else if (path === '/agents') body = [{...bot, id:2, name:'Builder'}, bot]; else if (path === '/agents/1') body = bot;
      else if (path === '/threads') body = [thread]; else if (path === '/threads/1') body = thread;
      else if (path.endsWith('/events/stream')) return route.fulfill({ contentType: 'text/event-stream', body: (flowEvents || [event()]).map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
      else if (path.endsWith('/events')) body = { events: flowEvents || [event()], has_more: false };
      else if (path === '/engines') body = [{ id: 'claude', label: 'Claude', kind: 'cli', installed: true, available: true, signed_in: true, models: [], capabilities: { tools: true, approvals: true, mcp: true } }];
      else if (path === '/local/status') body = { enabled: true, available: true, tools_enabled: true };
      else if (path === '/local/sandbox') body = { protected: true };
      else if (path === '/integrations/composio') body = { configured: false };
      else if (path === '/integrations/composio/catalog') body = { source: 'starter', complete: true, apps: [], categories: [], total: 0 };
      else if (path === '/team') body = { team: { id: 1, lead_agent_id: 1 }, agents: [bot], members: [], jobs: [], limits: {}, enabled: true, lead_ready: { ok: true } };
      else if (path === '/notifications/unread-count') body = { unread: 0 };
      else if (path === '/agents/1/computer') return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      else if (/\/(skills|rooms|approvals|computers|notifications|accounts|jobs|devices)$/.test(path)) body = [];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${origin}/login/?next=/chat?thread=1`);
    const loginForm = page.locator('form'); await loginForm.locator('input').first().waitFor();
    assert.equal(await loginForm.locator('p.text-muted').count(), 1, 'only the applicable sign-in instructions');
    assert.ok(!(await loginForm.innerText()).includes('passphrase'));
    await page.screenshot({path:`${screenshots}first-sign-in-${width}-${language}.png`});
    await loginForm.locator('input').nth(0).fill('fixture-code-only');
    await loginForm.locator('input').nth(1).fill('fixture-code-only');
    await loginForm.locator('button[type=submit]').click();
    const welcome = page.getByTestId('chat-welcome'); await welcome.waitFor();
    assert.ok((await welcome.boundingBox()).width <= width * .94);
    const members = page.locator('[data-starter-members]');
    const namesFit = await members.evaluate(el => {
      const rect = el.getBoundingClientRect(), rail = el.closest('.bot-rail').getBoundingClientRect();
      return rect.top >= rail.top && rect.bottom <= rail.bottom;
    });
    assert.equal(namesFit, true, 'starter team names fit inside the rail');
    await page.screenshot({path:`${screenshots}welcome-${width}-${language}.png`});
    const dismiss = welcome.getByRole('button').last();
    assert.equal(await dismiss.evaluate(el => el.parentElement.classList.contains('border-t')), true);
    await welcome.getByRole('button').first().click();
    await page.locator('.message-bubble').first().waitFor();
    assert.equal(await page.locator('[data-testid=answered-card]').count(), 0, 'welcome choice is a normal person message');
    assert.equal(await page.locator('.message-bubble').first().evaluate(el => getComputedStyle(el.parentElement.parentElement).alignItems), 'flex-end');
    await page.reload();
    const freshConnect = page.getByTestId('chat-connect'); await freshConnect.waitFor();
    await freshConnect.getByRole('button').first().click();
    const dialog = page.getByRole('dialog'); await dialog.getByTestId('google-app-setup').waitFor();
    await inView(dialog.locator('input').first());
    assert.equal(await dialog.locator('input').first().inputValue(), 'Personal');
    assert.equal(await dialog.locator('select').isVisible(), false, 'alternative sign-in methods stay in Advanced');
    assert.ok(!(await dialog.innerText()).match(/Bearer Token|Additional provider field|api key/i));
    await dialog.locator('input').nth(1).fill('12345-fixture.apps.googleusercontent.com');
    await dialog.locator('input[type=password]').fill('GOCSPX-' + 'fixture_secret_value_12345');
    await dialog.locator('button[type=submit]').click();
    await freshConnect.locator('select').waitFor();
    assert.equal(await freshConnect.locator('select').inputValue(), 'read');
    assert.deepEqual(grants, {});
    await freshConnect.getByRole('button').first().click();
    await page.getByTestId('answered-card').waitFor();
    assert.deepEqual(grants, {account:'read'});
    for (const popup of context.pages()) if (popup !== page) await popup.close();
    // Auto-read receipts resolve immediately without ever requesting approval.
    flowEvents = [makeEvent(1, 'user.message', {text:'Read my notes and connected inbox'})];
    for (let n = 0; n < 8; n++) {
      flowEvents.push(makeEvent(2 + n * 3, 'tool.started', {call_id:`read-${n}`, name:'api__read', summary:'Read notes', input:{path:'MEMORY.md'}}));
      flowEvents.push(makeEvent(3 + n * 3, 'approval.resolved', {approval_id:`read-approval-${n}`, status:'allowed', by:'workspace_read'}));
      flowEvents.push(makeEvent(4 + n * 3, 'tool.completed', {call_id:`read-${n}`, ok:true, output:'Fixture notes'}));
    }
    flowEvents.push(makeEvent(26, 'assistant.message', {text:'Draft prepared from the notes; publication awaits your approval.'}));
    await page.reload();
    await page.getByRole('log').getByText('Draft prepared from the notes; publication awaits your approval.', {exact:true}).waitFor();
    assert.equal(await page.locator('.approval-waiting, .approval-card, .notification-badge.waiting, .chat-waiting-strip').count(), 0, 'reads show no card, notification or waiting strip');
    assert.equal(await page.locator('.bot-rail [role=status].bg-signal').count(), 0, 'reads do not light the waiting rail');
    // The first approval is still explicit after connecting and granting read access.
    flowEvents = [makeEvent(1, 'user.message', {text:'Create a file for my plan'}), makeEvent(2, 'approval.requested', {approval_id:'first-approval', tool:'Write', input:{file_path:'/fixture/plan.txt', content:'My plan'}})];
    await page.reload();
    const approval = page.locator('.approval-waiting'); await approval.waitFor();
    await approval.getByRole('button', {name:language === 'he' ? 'אישור' : 'Allow', exact:true}).evaluate(el => { el.click(); el.click(); });
    assert.equal(writes.filter(w => w.path === '/threads/1/approvals/first-approval').length, 1);
    await page.goto(`${origin}/settings/day/`);
    const day = page.getByTestId('day-settings');
    await day.locator('select').nth(1).waitFor();
    assert.equal(await day.locator('select').nth(1).inputValue(), '1', 'brief defaults to Chief even when Builder is first');
    const reminderText = language === 'he' ? 'תזכיר לי מחר בבוקר להתקשר לרופא' : 'remind me tomorrow morning to call the dentist';
    await day.getByLabel(language === 'he' ? 'תזכורת' : 'Reminder', {exact:true}).fill(reminderText);
    await day.getByRole('button', {name:language === 'he' ? 'יצירת תזכורת' : 'Create reminder', exact:true}).click();
    await day.getByText('2026-11-05 09:00 UTC', {exact:true}).waitFor();
    assert.equal(writes.filter(w => w.path === '/chief/reminders').length, 1);
    for (const [path, title] of [['/settings/day/','Your day'], ['/settings/advanced/','Advanced'], ['/marketplace/','More tools']]) {
      await page.goto(origin + path); assert.equal(await page.title(), `${title} · Chief of Noumenon`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.goto(`${origin}/settings/engines/`);
    const sandbox = page.getByText(language === 'he' ? 'סביבת הבידוד פעילה: כלי הבוט פועלים בנפרד משאר המחשב.' : 'Sandbox on: bot tools run separated from the rest of this computer.', {exact:true});
    await sandbox.waitFor({state:'attached'});
    assert.equal(await sandbox.isVisible(), false, 'healthy sandbox status stays in Advanced');
    if (language === 'en') assert.equal(await page.getByRole('heading', {name:'Engines', exact:true}).count(), 1);
    await page.locator('details').filter({has:sandbox}).locator('summary').click();
    assert.equal(await sandbox.isVisible(), true);
    count++; console.log(`PASS fresh install ${width}px ${language}: sign-in, welcome bubble, guided connect, return, explicit read grant, approval, reminder, lead bot and titles`);
    connected = false; answers = 0; grants = {}; kind = 'question'; flowEvents = null; writes.length = 0;
    await page.goto(`${origin}/apps/`);
    await page.locator('[data-app-row]').first().waitFor();
    assert.equal(await page.locator('[data-app-row]').count(), 12);
    assert.equal(await page.getByText('0 connected', {exact:true}).count(), 0);
    await page.locator('.apps-search + div button').nth(1).click();
    while (await page.locator('[data-app-row]').count() < 268) {
      const before = await page.locator('[data-app-row]').count();
      await page.getByRole('button', {name:language === 'he' ? 'הצגת יישומים נוספים' : 'Show more apps', exact:true}).click();
      await page.waitForFunction(expected => document.querySelectorAll('[data-app-row]').length === expected, Math.min(268, before + 24));
    }
    assert.equal(await page.locator('[data-app-row]').count(), 268);
    const colors = await page.locator('[data-app-row] > span').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
    assert.ok(new Set(colors).size >= 4);
    assert.equal(await page.locator('[data-app-row] > span').first().evaluate(el => getComputedStyle(el).borderRadius), '10px');
    assert.ok(!(await page.locator('[data-app-row]').allTextContents()).join(' ').match(/102 actions|automated agents|Connected apps platform/));
    const publicApp = page.locator('[data-app-row]').filter({has: page.getByRole('heading', {name:'example000', exact:true})});
    await publicApp.getByRole('button').click();
    const publicForm = page.getByRole('dialog');
    assert.equal(await publicForm.locator('input').count(), 1, 'apps without sign-in do not ask for a made-up token');
    assert.equal(await publicForm.locator('button[type=submit]').isEnabled(), true);
    await publicForm.locator('form button').last().click();
    for (const appName of ['Google Drive', 'GitHub', 'Google Analytics']) {
      await page.locator('[data-app-row]').filter({has:page.getByRole('heading', {name:appName, exact:true})}).getByRole('button').click();
      const appForm = page.getByRole('dialog');
      assert.equal(await appForm.locator('select').inputValue(), 'oauth2', `${appName} defaults to browser sign-in`);
      if (appName.startsWith('Google')) {
        assert.equal(await appForm.getByTestId('google-app-setup').locator('ol li').count(), 6);
        assert.equal(await appForm.getByTestId('google-app-setup').locator('code').count(), 1);
        assert.ok((await appForm.innerText()).includes(appName));
      }
      await appForm.locator('form button').last().click();
    }
    await page.locator('[data-app-row]').first().getByRole('button').click();
    await inView(page.getByRole('dialog').locator('input').first());
    count++; console.log(`PASS apps ${width}px ${language}: all 268 reachable, plain descriptions, varied rounded tiles and Connect field in view`);
    const setup = page.getByTestId('google-app-setup'); await setup.waitFor();
    assert.equal(await setup.locator('ol li').count(), 6); assert.equal(await setup.locator('a[target="_blank"]').count(), 6); assert.equal(await setup.locator('code').count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width} ${language} Google overflow`);
    await page.screenshot({ path: `${screenshots}google-${width}-${language}.png`, fullPage: false });
    const form = page.locator('form').filter({ has: setup });
    const clientId = form.locator('input').nth(1), secret = form.locator('input[type=password]'), submit = form.locator('button[type=submit]');
    await clientId.fill('wrong'); await secret.fill('wrong'); assert.equal(await submit.isDisabled(), true);
    await clientId.fill('12345-fixture.apps.googleusercontent.com');
    const privateValue = 'GOCSPX-' + 'fixture_secret_value_12345';
    await secret.fill(privateValue); assert.equal(await submit.isEnabled(), true);
    await submit.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('input[type=password]')?.value);
    assert.equal(writes.filter(w => w.path === '/integrations/connector/oauth/gmail').length, 1);
    assert.ok(writes.every(w => !JSON.stringify(w).includes(privateValue) || w.path === '/integrations/connector/oauth/gmail'));
    assert.ok(!logs.join('\n').includes(privateValue));
    assert.equal(await page.evaluate(value => JSON.stringify(localStorage).includes(value), privateValue), false);
    for (const popup of context.pages()) if (popup !== page) await popup.close();
    count++; console.log(`PASS Google setup ${width}px ${language}, six steps, callbacks, keyboard submit and private fields`);
    await page.goto(`${origin}/chat?thread=1`);
    const question = page.getByTestId('chat-question'); await question.waitFor();
    assert.equal(await question.locator('img,a').count(), 0); assert.equal(await question.getByText(attack, { exact: true }).count(), 1);
    const option = question.getByRole('button').first(); assert.ok((await option.boundingBox()).height >= 44);
    await option.evaluate(el => { el.click(); el.click(); });
    await page.getByTestId('answered-card').waitFor(); assert.equal(answers, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    count++; console.log(`PASS question ${width}px ${language}, text injection, one answer and collapsed receipt`);
    kind = 'call'; answers = 0;
    const callPayload = {id:cardId, kind:'call', phone_number:'+13055550100', name:attack, purpose:'Book a table; number from the owner.', talking_points:[attack, 'Ask for a table for two at 7.'], details:'Booking name: Alex. ' + 'x'.repeat(270)};
    flowEvents = [makeEvent(1, 'chat.card', callPayload)];
    await page.reload();
    const call = page.getByTestId('chat-call'); await call.waitFor();
    const dial = call.getByRole('link', {name:language === 'he' ? 'חיוג' : 'Call', exact:true});
    assert.equal(await dial.isVisible(), true);
    assert.equal(await dial.getAttribute('href'), 'tel:+13055550100');
    assert.ok((await dial.boundingBox()).height >= 44);
    assert.equal(await call.locator('img').count(), 0);
    assert.equal(await call.locator('a').count(), 1);
    assert.equal(await call.locator('li').count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'call card has no horizontal scroll');
    const writesBeforeCopy = writes.length;
    await call.getByRole('button', {name:language === 'he' ? 'העתקת מספר' : 'Copy number', exact:true}).click();
    await call.getByRole('status').waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '+13055550100');
    assert.equal(writes.length, writesBeforeCopy, 'copy and rendering do not send anything');
    assert.equal(answers, 0, 'preparing and copying do not complete the card');
    await page.reload(); await dial.waitFor();
    assert.equal(await dial.getAttribute('href'), 'tel:+13055550100', 'replayed card remains callable');
    await page.screenshot({path:`${screenshots}call-${width}-${language}.png`, fullPage:false});
    await call.getByRole('button', {name:language === 'he' ? 'סיום' : 'Done', exact:true}).evaluate(el => { el.click(); el.click(); });
    await call.getByTestId('answered-card').waitFor();
    assert.equal(answers, 1);
    assert.deepEqual(writes.at(-1), {path:`/threads/1/cards/${cardId}`, body:{choice:0}});
    flowEvents.push(makeEvent(2, 'chat.card.answered', {id:cardId, answer:'Done'}));
    await page.reload(); await call.getByTestId('answered-card').waitFor();
    assert.equal(await dial.getAttribute('href'), 'tel:+13055550100');
    flowEvents = [makeEvent(1, 'chat.card', {...callPayload, phone_number:'3055550100;1'})];
    await page.reload(); await call.waitFor();
    assert.equal(await call.locator('a').count(), 0, 'unsafe number has no dialer link');
    assert.equal(await call.getByRole('button', {name:language === 'he' ? 'העתקת מספר' : 'Copy number', exact:true}).count(), 0);
    count++; console.log(`PASS call ${width}px ${language}: exact tel URL, 44px target, plain text, copy, reload, Done and no overflow`);
    flowEvents = null;
    kind = 'connect'; answers = 0; await page.reload();
    const connect = page.getByTestId('chat-connect'); await connect.locator('select').waitFor();
    assert.equal(await connect.locator('select').inputValue(), 'read'); assert.deepEqual(grants, {});
    const save = connect.getByRole('button').first(); await save.focus(); await page.keyboard.press('Enter');
    await page.getByTestId('answered-card').waitFor(); assert.deepEqual(grants, {account: 'read'}); assert.equal(answers, 1);
    count++; console.log(`PASS connect ${width}px ${language}, default Read only and explicit grant`);
    if (language === 'en') {
      kind = 'assistant'; await page.goto(`${origin}/chat?thread=1`);
      const reaction = page.getByRole('button', { name: 'Reply: Looks good, proceed', exact: true });
      await reaction.waitFor(); await reaction.evaluate(el => { el.click(); el.click(); });
      await page.waitForFunction(() => document.querySelector('button[aria-label="Reply: Looks good, proceed"]')?.getAttribute('aria-pressed') === 'true');
      assert.equal(writes.filter(w => w.path === '/threads/1/turns').length, 1);
      await page.goto(`${origin}/chat?thread=1&view=agents`);
      await page.getByLabel('Bot file to import').setInputFiles({ name: 'helper.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'open-dots.agent', version: 1, agent: { name: 'Imported helper', instructions: 'Help plan a day' } })) });
      const add = page.getByRole('dialog').getByRole('button', { name: 'Add bot', exact: true });
      await add.evaluate(el => { el.click(); el.click(); });
      await page.getByRole('heading', { name: 'Import bot', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(writes.filter(w => w.path === '/agents/import').length, 1);
      await page.goto(`${origin}/settings/account/`);
      const exportButton = page.getByRole('button', { name: 'Export my history', exact: true });
      await exportButton.waitFor().catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
      const download = page.waitForEvent('download');
      await exportButton.focus(); await page.keyboard.press('Enter');
      assert.ok((await download).suggestedFilename().endsWith('.zip'));
      await page.getByText('Export saved to your downloads.', { exact: true }).waitFor();
      const toast = page.locator('[aria-live=polite]').filter({ hasText: 'Export saved to your downloads.' }).last();
      const toastBox = await toast.boundingBox();
      assert.ok(toastBox.y + toastBox.height < 450, 'toast stays above composer area');
      if (width === 390) {
        const back = page.getByRole('link', { name: 'Back to chat', exact: true });
        assert.ok((await back.boundingBox()).height >= 44);
      }
      count++; console.log(`PASS audit ${width}px, import, history download, keyboard, single reactions and toast clearance`);
    }
    await context.close();
  }
  console.log(`${count} card browser checks passed, 0 failed`);
} finally { await browser.close(); }
