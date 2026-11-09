"use client";

import { useT } from "@/lib/use-i18n";

import { identityVar } from "@/lib/identity";

import { Select } from "@/components/ui/Select";

import { useCallback, useEffect, useId, useState } from "react";
import { api, ApiError, type Agent, type Computer, type ComputerHealth, type ComputerNetwork, type ComputerKind } from "@/lib/api";
import { LiveBrowser } from "./LiveBrowser";
import { LiveDesktop } from "./LiveDesktop";
import { isDesktopApp } from "@/lib/desktop-notifications";
import { DesktopPicture } from "./DesktopPicture";
import { BoatDesktop } from "./BoatDesktop";
import { NativeComputer } from "./NativeComputer";
import {
  ACTION_LABEL,
  NETWORK_MODES,
  computerStateLabel,
  computerCreationGate,
  computersUnsupported,
  effectiveState,
  hostedBrowserLine,
  imageLabel,
  lastCommandText,
  limitsText,
  nextActions,
  type ComputerAction,
} from "@/lib/computers";

const MUAPI_SIZES = [
  { memory_mb: 4096, label: "Small", detail: "2 vCPU · 4 GB · $0.036/hour" },
  { memory_mb: 8192, label: "Default", detail: "4 vCPU · 8 GB · $0.072/hour" },
  { memory_mb: 16384, label: "Large", detail: "8 vCPU · 16 GB · $0.144/hour" },
] as const;

const CLOUD_PROVIDERS = {
  muapi: {
    label: "Muapi",
    description: "Muapi cloud computers are shell-only for now. They have internet access and are billed per second from your Muapi credits while running (from $0.036/hour by size); stopped computers are free, and idle ones auto-stop after 15 minutes. You need at least a $1 balance to start.",
    status: () => api.muapiCredentialStatus(),
    save: (key: string) => api.saveMuapiCredential(key),
    remove: () => api.deleteMuapiCredential(),
  },
  boat: {
    label: "Boat",
    description: "Boat cloud computers run in your Boat account, have internet access, and may incur usage charges. They auto-archive one hour after creation or resume; an bot can resume one on a later turn when auto-start is enabled. Screenshots can be returned to the selected engine.",
    status: () => api.boatCredentialStatus(),
    save: (key: string) => api.saveBoatCredential(key),
    remove: () => api.deleteBoatCredential(),
  },
} as const;

const FIELD =
  "w-full rounded-md border border-line bg-transparent px-2 py-1 text-sm placeholder:text-muted";
const SMALL =
  "cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY =
  "cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 bg-accent text-accent-fg hover:opacity-90";

const REFRESH_MS = 10_000;

type Phase =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "none"; health: ComputerHealth | null }
  | { kind: "ready"; computer: Computer };

type Limits = { cpus: string; memory_mb: string; pids_limit: string; idle_minutes: string; image: string };

function limitsOf(computer: Computer): Limits {
  return {
    cpus: String(computer.cpus),
    memory_mb: String(computer.memory_mb),
    pids_limit: String(computer.pids_limit),
    idle_minutes: String(computer.idle_minutes),
    image: computer.image,
  };
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message || "That did not work.";
  return err instanceof Error ? err.message : "Could not reach the backend.";
}

// An agent's computer: whether it has one, its state, image and limits, what
// it ran last, and the buttons to make, start, stop, recreate or remove it.
export function ComputerView({
  agent, onChanged, engineSupportsComputers, engineLabel,
}: { agent: Agent; onChanged?: () => void; engineSupportsComputers: boolean | undefined; engineLabel: string }) {
  return <><NativeComputer key={agent.id} agent={agent.id} supported={agent.provider === "claude"} /><DockerComputerView agent={agent} onChanged={onChanged} engineSupportsComputers={engineSupportsComputers} engineLabel={engineLabel} /></>;
}

function DockerComputerView({
  agent,
  onChanged,
  engineSupportsComputers,
  engineLabel,
}: {
  agent: Agent;
  onChanged?: () => void;
  engineSupportsComputers: boolean | undefined;
  engineLabel: string;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [limits, setLimits] = useState<Limits | null>(null);
  const [kind, setKind] = useState<ComputerKind>("desktop");
  const [advanced, setAdvanced] = useState(false);
  const [network, setNetwork] = useState<ComputerNetwork>("default");
  const [provider, setProvider] = useState<"docker" | "muapi" | "boat">("docker");
  const [configured, setConfigured] = useState<Record<"muapi" | "boat", boolean | null>>({ muapi: null, boat: null });
  const [cloudKey, setCloudKey] = useState("");
  const [muapiSize, setMuapiSize] = useState<number>(8192);
  const isCloud = provider !== "docker";
  const cloud = provider === "muapi" ? CLOUD_PROVIDERS.muapi : CLOUD_PROVIDERS.boat;
  const cloudConfigured = isCloud ? configured[provider] : null;
  const [buildProgress, setBuildProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const capabilityHelpId = useId();
  const createGate = computerCreationGate(engineSupportsComputers, engineLabel);

  const load = useCallback(async () => {
    try {
      const computers = await api.listComputers();
      const computer = computers.find(item => item.agent_id === agent.id);
      if (!computer) {
        const health = await api.computersHealth().catch(() => null);
        setPhase({ kind: "none", health });
        return;
      }
      setPhase({ kind: "ready", computer });
      setLimits((current) => current ?? limitsOf(computer));
    } catch (err) {
      if (err instanceof ApiError && computersUnsupported(err.status, err.code)) {
        setPhase({ kind: "unsupported" });
      } else if (err instanceof ApiError && err.code === "no_computer") {
        const health = await api.computersHealth().catch(() => null);
        setPhase({ kind: "none", health });
      } else {
        setError(errorText(err));
      }
    }
  }, [agent.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read starts the panel
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    // Ask about a cloud key only after the owner picks that cloud provider.
    if (phase.kind !== "none" || phase.health?.hosted || provider === "docker") return;
    const key = provider;
    let active = true;
    void CLOUD_PROVIDERS[key].status().then((result) => {
      if (active) setConfigured((current) => ({ ...current, [key]: result.configured }));
    }).catch(() => {
      if (active) setConfigured((current) => ({ ...current, [key]: false }));
    });
    return () => { active = false; };
  }, [phase.kind, phase.kind === "none" ? phase.health?.hosted : false, provider]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result && typeof result === "object" && "id" in result && "agent_id" in result) {
        setPhase({ kind: "ready", computer: result as Computer });
        setLimits(limitsOf(result as Computer));
      } else {
        setLimits(null);
        await load();
      }
      onChanged?.();
    } catch (err) {
      setError(errorText(err));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (phase.kind === "loading") return error ? <div role="alert"><p className="text-danger">{error}</p><button className={SMALL} onClick={() => void load()}>{t("Try again")}</button></div> : <p role="status" className="text-sm text-muted">{t("Reading the computer…")}</p>;
  if (phase.kind === "unsupported")
    return <p className="text-sm text-muted">{t("This backend does not offer computers yet. Update it to give bots their own computer.")}</p>;

  const alert = error && (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  );

  if (phase.kind === "none") {
    const docker = phase.health;
    if (docker?.hosted) {
      return (
        <div className="space-y-2 text-sm text-muted">
          <p>{docker.error}</p>
          <p data-testid="hosted-browser-state">{hostedBrowserLine(docker)}</p>
          {docker.browser_local && <LiveBrowser agentId={agent.id} />}
        </div>
      );
    }
    return (
      <div className="space-y-3 text-sm">
        {alert}
        <svg className="computer-drawing" viewBox="0 0 120 88" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: identityVar(agent.id) }} aria-hidden="true">
          <rect x="10" y="8" width="100" height="62" rx="7" />
          <path d="M10 57h100M48 70v10m24-10v10M36 80h48M26 26h24m-24 9h40" />
        </svg>
        <p className="text-muted">
          {t("Give")}{" "}{agent.name}{" "}{t("a computer with a browser. The bot will still ask when your approval is needed.")}</p>
        {docker && !docker.available && <p className="text-warning">{t("Docker is not available:")}{" "}{docker.error}</p>}
        <button className={PRIMARY} disabled={busy || !createGate.enabled || !docker?.available} title={!createGate.enabled ? createGate.reason ?? undefined : !docker?.available ? "Docker must be available first." : undefined} onClick={() => void act(() => api.createAgentComputer(agent.id, { provider: "docker", kind: "desktop", network: "default", browser_enabled: true, start: true }))}>{busy ? t("Setting up…") : t("Set up a computer")}</button>
        {!createGate.enabled && <p className="text-xs text-muted">{createGate.reason}</p>}
        <details className="computer-setup">
          <summary>{t("Advanced")}</summary>
        <p className="text-xs text-muted">{t("This computer runs separately from the rest of your machine. Only this bot’s files are shared with it.")}</p>
        <fieldset className="space-y-1">
          <legend className="text-xs text-muted">{t("Location")}</legend>
          <label className="mr-4 inline-flex items-center gap-2">
            <input type="radio" name="computer-provider" checked={provider === "docker"} onChange={() => setProvider("docker")} />
            {t("Local")}</label>
          <label className="mr-4 inline-flex items-center gap-2">
            <input type="radio" name="computer-provider" checked={provider === "muapi"} onChange={() => { setProvider("muapi"); setKind("shell"); setCloudKey(""); }} />
            {t("Cloud · Muapi")}</label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="computer-provider" checked={provider === "boat"} onChange={() => { setProvider("boat"); setCloudKey(""); }} />
            {t("Cloud · Boat")}</label>
        </fieldset>
        {provider === "docker" ? (
          <p className="text-xs text-muted">{t("Local uses an isolated Docker computer on this machine. Only its workspace folder is shared with the bot.")}</p>
        ) : (
          <div className="space-y-2 rounded-md border border-line p-3">
            <p className="text-xs text-muted">{cloud.description} {t("Commands and files go to the cloud computer. Its files are not synced with this machine's workspace. The API key is encrypted in this Desktop profile and sent by the local backend only to authenticate")}{" "}{cloud.label} {t("API requests over HTTPS; it is not sent to the bot or cloud computer.")}</p>
            {cloudConfigured ? (
              <p className="text-xs text-muted">{cloud.label} {t("API key saved on this device. Enter a new key to replace it.")}</p>
            ) : (
              <p className="text-xs text-muted">{t("Add a")}{" "}{cloud.label} {t("API key to enable")}{" "}{cloud.label} {t("computers.")}{" "}{provider === "muapi" && <> {t("Get one at")}{" "}<a className="text-accent underline underline-offset-2 hover:opacity-80" href="https://muapi.ai/access-keys" target="_blank" rel="noopener noreferrer">{t("muapi.ai")}</a>.</>}</p>
            )}
            <form className="flex flex-wrap gap-2" onSubmit={async (event) => {
              event.preventDefault();
              if (!cloudKey.trim() || !isCloud) return;
              setBusy(true); setError(null);
              try {
                await cloud.save(cloudKey.trim());
                setConfigured((current) => ({ ...current, [provider]: true })); setCloudKey("");
              } catch (err) { setError(errorText(err)); }
              finally { setBusy(false); }
            }}>
              <input type="password" autoComplete="off" spellCheck={false} aria-label={`${cloud.label} API key`} placeholder={`${cloud.label} API key`} value={cloudKey} onChange={(event) => setCloudKey(event.target.value)} className={`${FIELD} min-w-48 flex-1`} />
              <button type="submit" disabled={busy || !cloudKey.trim()} className={SMALL}>{t("Save key on this device")}</button>
            </form>
            {cloudConfigured && isCloud && <button type="button" disabled={busy} className={SMALL} onClick={() => void act(async () => {
              await cloud.remove();
              setConfigured((current) => ({ ...current, [provider]: false }));
              setCloudKey("");
            })}>{t("Remove saved key")}</button>}
            {!isDesktopApp() && (
              <p className="text-xs text-muted">
                {t("Prefer local computers? The free desktop app can run one with Docker; no cloud API key required.")}{" "}
                <a className="text-accent underline underline-offset-2 hover:opacity-80" href="/download/">
                  {t("Download desktop app")}</a>
              </p>
            )}
          </div>
        )}
        {provider === "muapi" && (
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted">{t("Size (billed per second while running)")}</legend>
            {MUAPI_SIZES.map((size) => (
              <label key={size.memory_mb} className="mr-4 inline-flex items-center gap-2">
                <input type="radio" name="muapi-size" checked={muapiSize === size.memory_mb} onChange={() => setMuapiSize(size.memory_mb)} />
                {size.label} <span className="text-xs text-muted">{size.detail}</span>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="space-y-1">
          <legend className="text-xs text-muted">{t("Computer")}</legend>
          {(["shell", "desktop"] as const).map((value) => (
            <label key={value} className="mr-4 inline-flex items-center gap-2">
              <input type="radio" name="kind" checked={kind === value} disabled={provider === "muapi" && value === "desktop"} onChange={() => setKind(value)} />
              {value === "shell" ? t("Shell only") : t("Desktop")}
            </label>
          ))}
          {kind === "desktop" && provider === "docker" && <p className="text-xs text-muted">{t("Linux desktop with a browser. If the image is missing, build it here after giving the bot a computer. The first build downloads several hundred MB.")}</p>}
        </fieldset>
        {provider === "docker" && <fieldset className="space-y-1">
          <legend className="text-xs text-muted">{t("Network")}</legend>
          {NETWORK_MODES.map((mode) => (
            <label key={mode.value} className="flex cursor-pointer items-start gap-2 text-xs">
              <input type="radio" name="network" checked={network === mode.value} onChange={() => setNetwork(mode.value)} />
              <span>
                <span className="font-medium">{mode.label}</span> <span className="text-muted">{mode.description}</span>
              </span>
            </label>
          ))}
        </fieldset>}
        {provider === "docker" && kind === "desktop" && network === "default" && <p className="text-xs text-warning">{t("The browser can reach this machine's network, including your LAN and cloud metadata addresses. Use No network unless you need the internet.")}</p>}
        {!createGate.enabled && (
          <p id={capabilityHelpId} className="text-xs text-warning">
            {createGate.reason}
          </p>
        )}
        <button
          disabled={busy || !createGate.enabled || (isCloud && !cloudConfigured)}
          aria-describedby={!createGate.enabled ? capabilityHelpId : undefined}
          className={PRIMARY}
          onClick={() => act(() => api.createAgentComputer(agent.id, { provider, ...(provider === "docker" ? { network, browser_enabled: kind === "desktop", start: true } : {}), ...(provider === "muapi" ? { memory_mb: muapiSize } : {}), kind }))}
        >
          {busy ? t("Working…") : t("Give it a computer")}
        </button>
        </details>
      </div>
    );
  }

  const computer = phase.computer;
  const state = effectiveState(computer);
  const last = lastCommandText(computer);
  const actions = nextActions(computer);
  const draft = limits ?? limitsOf(computer);
  const run = (action: ComputerAction) => act(() => api.computerAction(computer.id, action));
  const saveLimits = () =>
    act(() =>
      api.updateComputer(computer.id, {
        cpus: Number(draft.cpus),
        memory_mb: Math.round(Number(draft.memory_mb)),
        pids_limit: Math.round(Number(draft.pids_limit)),
        idle_minutes: Math.round(Number(draft.idle_minutes)),
        ...(draft.image.trim() && draft.image.trim() !== computer.image ? { image: draft.image.trim() } : {}),
      })
    );

  return (
    <div className="space-y-3 text-sm">
      {alert}
      <p className="text-xs text-muted">{t("Blocking an app does not block its website. Sessions signed in on this bot's computer are available to this bot. Sign in by hand; never send passwords in chat.")}</p>
      {computer.provider === "docker" && computer.kind === "desktop" && computer.image === "open-dots-desktop:local" && /image.*(missing|not)|build bundled desktop image/i.test(`${computer.problem ?? ""} ${computer.last_error ?? ""}`) && (
        <div className="space-y-2">
          <button className={SMALL} disabled={busy} onClick={() => void act(async () => {
            let progress = await api.buildComputerImage(computer.id);
            setBuildProgress(progress.output);
            while (progress.status === "building") {
              await new Promise(resolve => setTimeout(resolve, 1000));
              progress = await api.computerImageProgress(computer.id);
              setBuildProgress(progress.output);
            }
            if (progress.status !== "succeeded") throw new Error("Desktop image build failed. Review the build output and retry.");
            return api.computerAction(computer.id, "start");
          })}>{busy && buildProgress ? t("Building desktop image…") : t("Build bundled desktop image")}</button>
          {buildProgress && <pre role="status" className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{buildProgress}</pre>}
        </div>
      )}
      {computer.kind === "desktop" && <><DesktopPicture computer={computer} onStart={actions.includes("start") ? () => void run("start") : undefined} busy={busy} />{computer.provider === "boat" ? <BoatDesktop computerId={computer.id} running={state === "running"} /> : <LiveDesktop computerId={computer.id} running={state === "running"} />}</>}
      <div className="rounded-md border border-line p-3">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{computerStateLabel(state)}</span>
          {computer.screen_busy && <span role="status" className="text-xs text-muted">{t("A conversation is using the screen. Other chats must wait, then take a fresh screenshot. Refused input is never queued.")}</span>}
          {computer.busy && <span className="rounded bg-hover px-1.5 text-xs">{t("in use by a turn")}</span>}
          {advanced && computer.provider === "docker" && <span className="font-mono text-xs text-muted" title={computer.image}>
            {imageLabel(computer.image)}
            {computer.image_pinned ? t(" · pinned") : t(" · not pinned")}
          </span>}
        </p>
        {advanced && <p className="mt-1 text-xs text-muted">
          {computer.provider === "muapi" ? `Cloud · Muapi ${MUAPI_SIZES.find((s) => s.memory_mb === computer.memory_mb)?.label ?? "Default"} · Internet enabled · billed per second from Muapi credits · auto-stops after 15 minutes idle` : computer.provider === "boat" ? t("Cloud · Internet enabled · auto-archives after 1 hour · resources managed by provider") : `${computer.provider} · ${NETWORK_MODES.find((m) => m.value === computer.network)?.label ?? computer.network} · ${limitsText(computer)}`}
          {computer.idle_minutes > 0 ? ` · stops after ${computer.idle_minutes} idle min` : t(" · never stops on its own")}
        </p>}
        {advanced && computer.workspace_path && (
          <p className="mt-1 truncate text-xs text-muted" title={computer.workspace_path}>
            {computer.workspace_path} → {computer.guest_workspace}
          </p>
        )}
        {computer.health && !computer.health.available && (
          <p className="mt-2 text-xs text-warning">{computer.provider === "boat" || computer.provider === "muapi" ? t("Cloud provider unavailable:") : t("Docker is not available:")} {computer.health.error}</p>
        )}
        {computer.problem && <p className="mt-2 text-xs text-warning">{computer.problem}</p>}
        {!computer.problem && computer.last_error && state !== "running" && (
          <p className="mt-2 text-xs text-warning">{computer.last_error}</p>
        )}
        {computer.needs_recreate && (
          <p className="mt-2 text-xs text-warning">
            {t("Settings changed since it was made. Recreate it for them to apply (files in the workspace folder stay).")}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {actions.map((action) => (
            <button key={action} disabled={busy || (computer.busy && action !== "start")} className={SMALL} onClick={() => run(action)}>
              {ACTION_LABEL[action]}
            </button>
          ))}
          <button disabled={busy} className={SMALL} onClick={() => void load()}>
            {t("Refresh")}</button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted">{t("Last command")}</p>
        {last ? (
          <>
            <p className="truncate font-mono text-xs" title={last}>
              {last}
            </p>
            {computer.last_command?.output && (
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-inset p-2 text-xs whitespace-pre-wrap">
                {computer.last_command.output}
              </pre>
            )}
          </>
        ) : (
          <p className="text-xs text-muted">{t("Nothing has run yet.")}</p>
        )}
      </div>

      {computer.provider === "docker" && <button className={SMALL} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{t("Advanced")}</button>}
      {advanced && computer.provider === "docker" && <>
      <form
        className="grid grid-cols-2 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          saveLimits();
        }}
      >
        <label className="text-xs text-muted">
          {t("CPUs")}<input type="number" step="0.1" min="0.1" max="64" value={draft.cpus} onChange={(e) => setLimits({ ...draft, cpus: e.target.value })} className={`${FIELD} mt-1`} />
        </label>
        <label className="text-xs text-muted">
          {t("Memory (MB)")}<input type="number" min="128" max="262144" value={draft.memory_mb} onChange={(e) => setLimits({ ...draft, memory_mb: e.target.value })} className={`${FIELD} mt-1`} />
        </label>
        <label className="text-xs text-muted">
          {t("Processes")}<input type="number" min="32" max="65536" value={draft.pids_limit} onChange={(e) => setLimits({ ...draft, pids_limit: e.target.value })} className={`${FIELD} mt-1`} />
        </label>
        <label className="text-xs text-muted">
          {t("Stop after idle (min, 0 never)")}<input type="number" min="0" max="10080" value={draft.idle_minutes} onChange={(e) => setLimits({ ...draft, idle_minutes: e.target.value })} className={`${FIELD} mt-1`} />
        </label>
        <label className="col-span-2 text-xs text-muted">
          {t("Image (applies on recreate; name@sha256:… pins it)")}<input value={draft.image} onChange={(e) => setLimits({ ...draft, image: e.target.value })} className={`${FIELD} mt-1 font-mono`} />
        </label>
        <div className="col-span-2 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy} className={SMALL}>
            {t("Save limits")}</button>
          <Select
            aria-label={t("Network")}
            value={computer.network}
            disabled={busy}
            onChange={(e) => act(() => api.updateComputer(computer.id, { network: e.target.value as ComputerNetwork }))}
            className="cursor-pointer rounded-md border border-line bg-transparent px-2 py-1 text-xs"
          >
            {NETWORK_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </Select>
          <label className="flex cursor-pointer items-center gap-1 text-xs text-muted">
            <input
              type="checkbox"
              checked={computer.auto_start}
              disabled={busy}
              onChange={() => act(() => api.updateComputer(computer.id, { auto_start: !computer.auto_start }))}
            />
            {t("Start when a turn needs it")}</label>
          {computer.kind === "desktop" && <label className="flex cursor-pointer items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={computer.browser_enabled} disabled={busy || computer.busy}
              onChange={() => act(() => api.updateComputer(computer.id, { browser_enabled: !computer.browser_enabled }))} />
            {t("Browser tools (requires the current desktop image)")}</label>}
        </div>
      </form>
      </>}

      <div className="border-t border-line pt-3">
        {confirmRemove ? (
          <p className="flex flex-wrap items-center gap-2 text-xs">
            {computer.provider === "muapi" ? t("Permanently delete the Muapi computer and its files?") : computer.provider === "boat" ? t("Permanently remove the cloud computer and its provider data? Boat deletion runs in the background while Chief of Noumenon waits for confirmation.") : t("Remove the computer? Everything inside it is lost; the workspace folder stays.")} {agent.name}{" "}{t("then works on this machine again.")}<button disabled={busy} className={SMALL} onClick={() => act(() => api.deleteComputer(computer.id)).then(() => setConfirmRemove(false))}>
              {t("Remove")}</button>
            <button disabled={busy} className={SMALL} onClick={() => setConfirmRemove(false)}>
              {t("Keep")}</button>
          </p>
        ) : (
          <button disabled={busy || computer.busy} className={SMALL} onClick={() => setConfirmRemove(true)}>
            {t("Remove computer…")}</button>
        )}
      </div>
    </div>
  );
}
