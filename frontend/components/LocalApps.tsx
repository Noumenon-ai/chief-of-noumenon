"use client";
import { useT as useUiText } from "@/lib/use-i18n";

import { useCallback, useEffect, useRef, useState } from "react";
import { appCategory, appDescription, appColor, compareApps, preferredAuth, credentialLabel } from "@/lib/local-apps-catalog";
import { GoogleAppSetup } from "@/components/GoogleAppSetup";
import { isGoogle, validGoogleClient } from "@/lib/google-setup";
import { useT } from "@/lib/use-i18n";
import { api, request } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";

export type Provider = { service: string; displayName: string; category: string; authTypes: string[]; description: string; homepageUrl?: string; actionCount: number; authConfigs?: { type: string; setup_guide?: { instructions?: string[] }; fields?: { key: string; label?: string; type?: string; required?: boolean }[] }[] };
export type AppConnection = { id: string; service: string; connectionName: string; status: string; statusMessage?: string; lastValidatedAt?: string };
type OAuth = { service: string; configured: boolean; callbackUrl: string; defaultScopes: string[] };
export type LocalCatalog = { providers: Provider[]; connections: AppConnection[]; oauth: OAuth[] };
const PATH = "/integrations/connector";
const selectClass = "w-full rounded-md border border-line bg-surface p-2 text-sm";

export function LocalApps({ onlyProvider, onConnected, onCancel }: { onlyProvider?: string; onConnected?: (connection: AppConnection) => void; onCancel?: () => void }) {
  const tx = useUiText();
  const t = useT();
  const working = useRef(false);
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [oauthWaiting, setOauthWaiting] = useState(false);
  const popup = useRef<Window | null>(null);
  const connectionForm = useRef<HTMLFormElement>(null);
  const [catalog, setCatalog] = useState<LocalCatalog | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Provider | null>(null);
  useEffect(() => {
    if (!selected) return;
    const frame = requestAnimationFrame(() => {
      const first = connectionForm.current?.querySelector<HTMLInputElement>("input");
      first?.focus(); first?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected]);
  const [visible, setVisible] = useState(12);
  const [alias, setAlias] = useState("Personal");
  const [authType, setAuthType] = useState("api_key");
  const [values, setValues] = useState<Record<string, string>>({});
  const [extraFields, setExtraFields] = useState<string[]>([]);
  const [fieldName, setFieldName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<{ id: number; name: string }[]>([]);
  const [agentId, setAgentId] = useState("");
  const [grants, setGrants] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const choose = useCallback((provider: Provider, name: string, data: LocalCatalog | null) => {
    setSelected(provider); setAlias(name); setAuthType(preferredAuth(provider.authTypes, !!data?.oauth.some(item => item.service === provider.service)));
    setValues({}); setExtraFields([]); setFieldName(""); setClientId(""); setClientSecret("");
  }, []);
  async function refresh() {
    const data = await request<LocalCatalog>(PATH);
    setCatalog(data);
    const connected = data.connections.find(c => c.service === onlyProvider && ["active", "added"].includes(c.status));
    if (connected) onConnected?.(connected);
  }
  useEffect(() => {
    let active = true;
    Promise.all([request<LocalCatalog>(PATH), api.listAgents()]).then(([data, bots]) => {
      if (active) { setCatalog(data); setAgents(bots); const initial = onlyProvider || new URLSearchParams(window.location.search).get("app"); if (initial) {
        setSearch(initial);
        const provider = data.providers.find(p => p.service === initial);
        if (provider) choose(provider, "Personal", data);
        else setError(t("This app is unavailable."));
      }
      const connected = data.connections.find(c => c.service === onlyProvider && ["active", "added"].includes(c.status));
      if (connected) onConnected?.(connected); if (new URLSearchParams(window.location.search).get("status") === "error") setError("Sign-in was not completed. Reconnect this account."); }
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [onlyProvider, onConnected, t, choose]);
  useEffect(() => {
    if (!agentId) return;
    let active = true;
    request<Record<string, string>>(`${PATH}/grants/${agentId}`).then(data => { if (active) setGrants(data); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [agentId]);
  async function perform(work: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await work(); await refresh(); }
    catch { popup.current?.close(); setOauthWaiting(false); setError(t("The connection could not be updated. Check the fields and retry.")); }
    finally { setBusy(false); working.current = false; }
  }
  useEffect(() => {
    if (!oauthWaiting) return;
    const deadline = Date.now() + 10 * 60 * 1000;
    const timer = setInterval(() => {
      if (Date.now() > deadline) { setOauthWaiting(false); setError(t("Sign-in timed out. Retry when you are ready.")); return; }
      request<LocalCatalog>(PATH).then(data => {
        setCatalog(data);
        const found = data.connections.find(c => c.service === selected?.service && c.connectionName === alias && ["active", "added"].includes(c.status));
        if (found) { setOauthWaiting(false); popup.current?.close(); setSelected(null); onConnected?.(found); }
      }).catch(() => { setOauthWaiting(false); setError(t("Could not check sign-in. Retry.")); });
    }, 1500);
    return () => clearInterval(timer);
  }, [oauthWaiting, selected?.service, alias, onConnected, t]);
  const oauth = catalog?.oauth.find(item => item.service === selected?.service);
  const fields = selected?.authConfigs?.filter(config => config.type === authType).flatMap(config => config.fields ?? []) ?? [];
  const credentialFields = authType === "no_auth" ? [] : fields.length ? fields : [{ key: authType === "api_key" ? "apiKey" : "accessToken", label: "API key or token", type: "password", required: true }];
  const matching = catalog?.providers.filter(p => (!category || appCategory(p.category) === category)
    && (!connectedOnly || catalog.connections.some(c => c.service === p.service && ["active", "added"].includes(c.status)))
    && `${p.service} ${p.displayName} ${p.category}`.toLowerCase().includes(search.toLowerCase())).sort(compareApps) || [];
  function closeForm() { popup.current?.close(); setOauthWaiting(false); setSelected(null); setValues({}); setClientId(""); setClientSecret(""); onCancel?.(); }
  const form = selected && <form ref={connectionForm} className="space-y-3 rounded-md border border-line p-4" onSubmit={e => { e.preventDefault(); if (working.current) return; if (authType === "oauth2") popup.current = window.open("about:blank", "chief-app-sign-in"); void perform(async () => {
        if (authType === "oauth2") {
          if (isGoogle(selected.service) && !validGoogleClient(clientId, clientSecret, oauth?.configured)) throw new Error("Invalid client");
          const link = await request<{ url: string }>(`${PATH}/oauth/${selected.service}`, { method: "POST", body: JSON.stringify({ connectionName: alias, clientId, clientSecret, returnUrl: window.location.origin + "/apps/" }) });
          setClientId(""); setClientSecret("");
          if (!popup.current || popup.current.closed) throw new Error("Allow the sign-in tab");
          popup.current.location.assign(link.url); setOauthWaiting(true);
        } else {
          await request(`${PATH}/connections/${selected.service}`, { method: "PUT", body: JSON.stringify({ connectionName: alias, authType, values }) });
          setValues({}); setSelected(null); setNotice("Account added. Choose a bot and allow this account above.");
        }
      }); }}>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {oauthWaiting && <p role="status">{t("Finish signing in in the new tab. This card will update when you return.")}</p>}
        {!isGoogle(selected.service) && <p className="text-sm text-muted">{t(appDescription(selected))}</p>}
        {!isGoogle(selected.service) && selected.authConfigs?.find(c => c.type === authType)?.setup_guide?.instructions?.map((step, index) => <p key={index} className="text-sm text-muted">{step}</p>)}
        <label className="block text-sm">{tx("Account name")}<Input value={alias} onChange={e => setAlias(e.target.value)} required maxLength={100} /></label>
        <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">{t("Advanced")}</summary>
          <label className="block text-sm">{tx("Sign-in method")}<select className={selectClass} value={authType} onChange={e => { setAuthType(e.target.value); setValues({}); }}>{[...new Set([...(oauth ? ["oauth2"] : []), ...selected.authTypes])].map(type => <option key={type} value={type}>{t(type === "oauth2" ? "Sign in with your account" : type === "no_auth" ? "No sign-in needed" : type === "custom_credential" ? "Account details" : "Use an account key or token")}</option>)}</select></label>
        </details>
        {authType === "oauth2" ? oauth ? <>
          {isGoogle(selected.service) && <GoogleAppSetup service={selected.service} callbacks={catalog!.oauth.filter(item => ["gmail", "googlecalendar"].includes(selected.service) ? ["gmail", "googlecalendar"].includes(item.service) : item.service === selected.service).map(item => ({ ...item, displayName: catalog!.providers.find(p => p.service === item.service)?.displayName }))} />}
          {!isGoogle(selected.service) && <p className="break-words text-sm text-muted">{tx("Create a sign-in client in this app’s settings. Use this return address:")}{" "}<code>{oauth.callbackUrl}</code>{tx("Allow these permissions:")}{" "}{oauth.defaultScopes.join(", ")}{tx("Enter its Client ID and Client secret below, then sign in.")}{" "}{oauth.configured && t("Leave both fields empty to use your saved client.")}</p>}
          {isGoogle(selected.service) && oauth.configured && <p className="text-sm">{t("Leave both fields empty to use your saved client.")}</p>}
          <label className="block text-sm">{tx("Client ID")}<Input autoComplete="off" value={clientId} onChange={e => setClientId(e.target.value)} /></label>
          <label className="block text-sm">{tx("Client secret")}<Input type="password" autoComplete="new-password" spellCheck={false} value={clientSecret} onChange={e => setClientSecret(e.target.value)} /></label>
          {isGoogle(selected.service) && (clientId || clientSecret) && !validGoogleClient(clientId, clientSecret, oauth.configured) && <p role="status" className="text-sm">{t("Paste the Web application client ID ending in .apps.googleusercontent.com and the secret starting with GOCSPX-. Both fields are needed.")}</p>}
        </> : <p role="status" className="text-sm">{tx("Browser sign-in is not available for this app yet. Open Advanced to choose another method.")}</p> : credentialFields.map(field => <label className="block text-sm" key={field.key}>{t(credentialLabel(field, selected.displayName))}<Input type={field.type === "text" ? "text" : "password"} autoComplete="new-password" value={values[field.key] ?? ""} onChange={e => setValues({ ...values, [field.key]: e.target.value })} required={field.required !== false} /></label>)}
        {authType !== "oauth2" && authType !== "no_auth" && <details className="space-y-2"><summary className="min-h-11 cursor-pointer py-3">{t("More account settings")}</summary>
          {extraFields.map(key => <label key={key} className="block text-sm">{key}<Input type="password" autoComplete="new-password" value={values[key] ?? ""} onChange={e => setValues({ ...values, [key]: e.target.value })} required /></label>)}
          <label className="block text-sm">{tx("Setting name from your app")}<Input value={fieldName} onChange={e => setFieldName(e.target.value)} maxLength={80} /></label>
          <Button type="button" disabled={!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldName) || extraFields.includes(fieldName) || credentialFields.some(f => f.key === fieldName)} onClick={() => { setExtraFields([...extraFields, fieldName]); setFieldName(""); }}>{tx("Add setting")}</Button>
        </details>}
        <p className="text-xs text-muted">{tx(authType === "no_auth" ? "This app does not need a sign-in." : "Enter credentials here only. Never paste keys or passwords in chat.")}</p>
        <div className="flex gap-2"><Button variant="primary" type="submit" disabled={busy || oauthWaiting || (authType === "oauth2" && (!oauth || (isGoogle(selected.service) && !validGoogleClient(clientId, clientSecret, oauth.configured))))}>{busy ? tx("Connecting...") : tx("Connect")}</Button><Button type="button" onClick={closeForm}>{tx("Cancel")}</Button></div>
      </form>;
  return <section className="space-y-4" aria-label={tx("Self-hosted connected apps")}>
    <p className="text-sm text-muted">{tx("Connect an app, then choose which bots can use it.")}</p>
    {error && !selected && <p role="alert" className="text-sm text-danger">{error} <Button type="button" disabled={busy} onClick={() => void perform(refresh)}>{t("Retry")}</Button></p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!catalog && !error && <p role="status" className="text-sm text-muted">{tx("Loading local app catalog...")}</p>}
    {!catalog && error && <><p className="text-sm text-muted">{tx("Start the local connector and configure its data folder on the server. A sandbox with network isolation is required for bot access.")}</p><Button onClick={() => void perform(async () => {})} disabled={busy}>{tx("Retry")}</Button></>}
    {catalog && <>
      {!onlyProvider && <>
      {catalog.connections.length > 0 && <>
      <button type="button" className="min-h-11 rounded-full border border-line px-4 text-sm" aria-pressed={connectedOnly} onClick={() => { setConnectedOnly(!connectedOnly); setVisible(12); }}>{t("{count} connected", { count: catalog.connections.filter(c => ["active", "added"].includes(c.status)).length })}</button>
      <h3 className="text-sm font-semibold">{tx("Accounts")}</h3>
      {catalog.connections.map(c => <div key={c.id} className="rounded-md border border-line p-3 text-sm">
        <p>{catalog.providers.find(p => p.service === c.service)?.displayName || c.service} · {c.connectionName} · {c.status === "active" && c.lastValidatedAt ? tx("Signed in") : c.status === "active" || c.status === "added" ? tx("Added (not verified)") : c.status}</p>
        {c.statusMessage && <p role="status">{c.statusMessage}</p>}
        <div className="mt-2 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void perform(() => request(`${PATH}/connections/${c.id}/test`, { method: "POST" }))}>{tx("Check sign-in")}</Button>{catalog.providers.some(p => p.service === c.service) && <Button disabled={busy} onClick={() => { const p = catalog.providers.find(p => p.service === c.service); if (p) choose(p, c.connectionName, catalog); }}>{tx("Reconnect")}</Button>}<Button disabled={busy} onClick={() => void perform(() => request(`${PATH}/connections/${c.id}`, { method: "DELETE" }))}>{tx("Remove")}</Button></div>
      </div>)}
      <label className="block text-sm">{tx("Bot access")}<select className={selectClass} value={agentId} onChange={e => { setAgentId(e.target.value); setGrants({}); }}><option value="">{tx("Choose a bot")}</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {agentId && <><p className="text-xs text-muted">{tx("Each account starts Off. Act approvals remain required in autonomous routines.")}</p>{catalog.connections.map(c => <label key={c.id} className="block text-sm">{catalog.providers.find(p => p.service === c.service)?.displayName || c.service} · {c.connectionName}<select className={selectClass} value={grants[c.id] ?? "off"} onChange={e => { const next = { ...grants }; if (e.target.value === "off") delete next[c.id]; else next[c.id] = e.target.value; setGrants(next); }}><option value="off">{tx("Off")}</option><option value="read">{tx("Read only")}</option><option value="act">{tx("Read and ask to act")}</option></select></label>)}<Button disabled={busy} onClick={() => void perform(async () => { await request(`${PATH}/grants/${agentId}`, { method: "PUT", body: JSON.stringify(grants) }); setNotice("Access saved. Start a new turn to use newly granted accounts."); })}>{tx("Save bot access")}</Button></>}

      </>}
      <h3 className="text-sm font-semibold">{tx("Find an app")}</h3>
      <div className="apps-search"><Input aria-label={t("Search apps")} placeholder={t("Search apps")} value={search} onChange={e => { setSearch(e.target.value); setVisible(12); }} /></div>
      <div className="flex flex-wrap gap-2" aria-label={tx("App categories")}>{["", "Productivity", "Communication", "Design", "Code", "Data", "Sales", "Marketing", "Finance", "Research", "Support"].map(value => <button key={value} className="min-h-11 rounded-field border border-line px-3 text-sm aria-pressed:bg-hover" aria-pressed={category === value} onClick={() => { setCategory(value); setVisible(12); }}>{t(value || tx("All"))}</button>)}</div>
      <h3 className="text-sm font-semibold">{t(connectedOnly ? tx("Connected apps") : category || tx("All apps"))}</h3>
      <div className="space-y-2">
        {matching.slice(0, visible).map(p => <div data-app-row key={p.service} className="flex items-center justify-between gap-3 rounded-md border border-line p-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-avatar font-semibold text-white" style={{ backgroundColor: appColor(p.service) }}>{p.displayName.charAt(0).toUpperCase()}</span><div className="min-w-0 flex-1 break-words"><h3 className="text-sm font-semibold">{p.displayName}</h3><p className="text-xs text-muted">{t(appDescription(p))}</p></div>
          <Button disabled={busy} onClick={() => choose(p, "Personal", catalog)}>{t(catalog.connections.some(c => c.service === p.service && ["active", "added"].includes(c.status)) ? tx("Connected") : tx("Connect"))}</Button>
        </div>)}
      </div>
      <p className="text-xs text-muted">{t("Showing {count} of {total} apps", { count: Math.min(visible, matching.length), total: matching.length })}</p>
      {visible < matching.length && <Button onClick={() => setVisible(count => count + 24)}>{t("Show more apps")}</Button>}
      {!matching.length && <p role="status" className="text-sm text-muted">{t("No apps match. Try another search or category.")}</p>}
      </>}
      {onlyProvider ? form : <Dialog focusFirstField open={!!selected} onOpenChange={open => { if (!open) closeForm(); }} title={`${t("Connect")} ${selected?.displayName || ""}`}>{form}</Dialog>}
    </>}
  </section>;
}
