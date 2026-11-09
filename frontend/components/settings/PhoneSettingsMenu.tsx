"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useT } from "@/lib/use-i18n";
import { request } from "@/lib/api";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
const links = [
  ["Usage", "/chat/?panel=usage"], ["Connect apps", "/apps/"], ["Permissions", "/settings/approvals/"],
  ["Time zone", "/settings/day/#setting-day"], ["Bot computers", "/chat/?panel=computer"],
  ["Devices", "/settings/account/#setting-account-devices"], ["Notifications", "/settings/notifications/"],
  ["Appearance", "/settings/#setting-general-appearance"], ["Language", "/settings/#setting-general-language"],
  ["Help", "/onboarding/"], ["Privacy", "/settings/account/#setting-account-history"],
] as const;
export function PhoneSettingsMenu() {
  const t = useT();
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function automatic() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const prefs = await request<Record<string, unknown>>("/chief/preferences");
      await request("/chief/preferences", { method: "PUT", body: JSON.stringify({ ...prefs, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      setMessage(t("Time zone saved."));
    } catch { setMessage(t("Could not save the time zone. Retry.")); }
    finally { lock.current = false; setBusy(false); }
  }
  return <nav className="rounded-card border border-line md:hidden" aria-label={t("palette.settings")}>
    <ul className="divide-y divide-line">{links.map(([label, href]) => <li key={label} className="flex flex-wrap items-center justify-between px-3">
      <Link href={href} className="flex min-h-11 items-center py-3 text-sm">{t(label)}</Link>
      {label === "Time zone" && <Button disabled={busy} onClick={() => void automatic()}>{t("Set automatically")}</Button>}
    </li>)}<li><button className="min-h-11 w-full px-3 py-3 text-start text-sm" onClick={async () => { await auth.logout(); router.push("/login/"); }}>{t("Sign out")}</button></li></ul>
    {message && <p role="status" className="p-3 text-sm">{message}</p>}
  </nav>;
}
