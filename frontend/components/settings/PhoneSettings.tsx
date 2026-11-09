"use client";

import { useT } from "@/lib/use-i18n";
import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { request } from "@/lib/api";
import { useSession } from "@/components/AuthGate";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { SettingsCard } from "./SettingsCard";

type Status = { state: "not_installed" | "signed_out" | "ready" | "on" | "failed" | "unavailable"; message: string; address: string; help_url?: string; account?: string; other_devices?: number | null; online_devices?: number | null };
type Code = { url: string; expires_at: string };
const download = "https://tailscale.com/download";
const sameOriginBuild = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1") === "/api/v1";
const unavailable: Status = { state: "unavailable", address: "", message: "Use the installed website to set up your phone. This separate development frontend cannot make a working phone link." };

function Qr({ text }: { text: string }) {
  const t = useT();
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (qr.isDark(y, x)) path += `M${x + 4},${y + 4}h1v1h-1z`;
  return <svg role="img" aria-label={t("phone.qr")} data-testid="phone-qr" viewBox={`0 0 ${size + 8} ${size + 8}`} width="240" height="240" className="max-w-full" shapeRendering="crispEdges"><rect width="100%" height="100%" fill="#fff" /><path d={path} fill="#000" /></svg>;
}

export function PhoneSettings() {
  const t = useT();
  const { session } = useSession();
  const admin = session?.scopes.includes("admin");
  const [status, setStatus] = useState<Status | null>(sameOriginBuild ? null : unavailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState<Code | null>(null);

  useEffect(() => {
    if (!sameOriginBuild || !admin) return;
    let live = true;
    request<Status>("/phone/status", { method: "POST", body: "{}" }).then(value => { if (live) setStatus(value); })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : "Could not check phone access."); });
    return () => { live = false; };
  }, [admin]);
  useEffect(() => {
    if (!code) return;
    const timer = setTimeout(() => setCode(null), Math.max(0, Date.parse(code.expires_at) - Date.now()));
    return () => clearTimeout(timer);
  }, [code]);

  async function run(action: "status" | "on" | "off" | "pairing-code") {
    setBusy(true); setError(""); setCode(null);
    try {
      if (action === "pairing-code") setCode(await request<Code>("/phone/pairing-code", { method: "POST", body: "{}" }));
      else setStatus(await request<Status>(`/phone/${action}`, { method: "POST", body: "{}" }));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update phone access. Try again."); }
    finally { setBusy(false); }
  }

  return <div id="setting-phone" data-setting-container tabIndex={-1} className="min-w-0 space-y-5 break-words">
    <SettingsCard title={t("phone.title")} description={t("phone.help")}>
      {!admin ? <p>{t("phone.owner")}</p> : <>
        {error && <Banner tone="danger">{error}</Banner>}
        {!status && !error && <p role="status">{t("phone.checking")}</p>}
        {status?.state === "unavailable" ? <p>{status.message}</p> : <ol className="list-decimal space-y-5 ps-5">
          <li><p className="font-semibold">{t("phone.devices")}</p>
            {status?.account && <p className="mt-1 text-sm">{t("phone.account", { account: status.account })}</p>}
            {status?.other_devices === 0 && <p className="mt-1 text-sm">{t("phone.noPhone", { account: status.account || t("phone.sameAccount") })}</p>}
            {status?.other_devices != null && <p className="mt-1 text-sm text-muted">{t("phone.counts", { joined: status.other_devices, online: status.online_devices ?? 0 })}</p>}
            <p className="mt-1 text-sm text-muted">{t("phone.tailBefore")} <a className="underline" href={download} target="_blank" rel="noreferrer">{t("phone.install")}</a> {t("phone.tailAfter")}</p>
          </li>
          <li><p className="font-semibold">{t("phone.privateLink")}</p>
            {status && <p className="mt-1 text-sm" role="status">{status.message}</p>}
            {status?.help_url && <a className="inline-flex min-h-11 items-center underline" href="https://login.tailscale.com/admin/dns" target="_blank" rel="noreferrer">{t("phone.https")}</a>}
            <div className="mt-3 flex flex-wrap gap-2">
              {status?.state === "ready" && <Button variant="primary" disabled={busy} onClick={() => void run("on")}>{t("phone.on")}</Button>}
              {status?.state === "on" && <Button disabled={busy} onClick={() => void run("off")}>{t("phone.off")}</Button>}
              <Button disabled={busy} onClick={() => void run("status")}>{busy ? t("phone.check") : t("phone.again")}</Button>
            </div>
            {status?.state === "on" && <>
              <a data-testid="phone-address" className="mt-3 block break-all underline" href={status.address}>{status.address}</a>
              <p className="mt-3 text-sm font-semibold">{t("phone.cantOpen")}</p>
              <ul className="list-disc ps-5 text-sm space-y-1">
                {["phone.connected", "phone.same", "phone.vpn", "phone.minute"].map(key => <li key={key}>{t(key)}</li>)}
              </ul>
            </>}
          </li>
          <li><p className="font-semibold">{t("phone.scan")}</p>
            {status?.state === "on" ? <div className="mt-2 space-y-3">
              {code ? <><Qr text={code.url} /><p className="text-sm text-muted">{t("phone.codeHelp")}</p></> : <p className="text-sm text-muted">{t("phone.readyCode")}</p>}
              <Button disabled={busy} onClick={() => void run("pairing-code")}>{code ? t("phone.newCode") : t("phone.showCode")}</Button>
            </div> : <p className="mt-1 text-sm text-muted">{t("phone.linkFirst")}</p>}
          </li>
        </ol>}
      </>}
    </SettingsCard>
    <SettingsCard title={t("phone.home")}>
      <p className="text-sm">{t("phone.iphone")}</p>
      <p className="text-sm">{t("phone.android")}</p>
      <p className="text-sm text-muted">{t("phone.keep")}</p>
    </SettingsCard>
  </div>;
}
