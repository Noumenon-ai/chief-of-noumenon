"use client";
import { useState } from "react";
import { googleSteps } from "@/lib/google-setup";
import { useT } from "@/lib/use-i18n";
import { Button } from "@/components/ui/Button";

export function GoogleAppSetup({ callbacks, service }: { callbacks: { service: string; callbackUrl: string; displayName?: string; defaultScopes?: string[] }[]; service: string }) {
  const t = useT();
  const [copied, setCopied] = useState("");
  return <div className="space-y-4" data-testid="google-app-setup">
    <h3 className="text-lg font-semibold">{t("Your Google project")}</h3>
    <p className="text-sm text-muted">{t("Use your own Google project to sign in. Gmail and Calendar can share the same client.")}</p>
    <ol className="space-y-3">
      {googleSteps(service).map(([label, url], index) => <li key={url} className="flex items-start gap-3">
        <span className="pt-3 font-mono text-sm" aria-hidden="true">{index + 1}.</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-field border border-line px-3 py-2 text-sm underline">{t(label)}<span className="sr-only"> · {t("Opens a new tab")}</span></a>
      </li>)}
    </ol>
    <p className="text-sm">{t("In Branding, enter an app name and your email. In Audience, choose External. Keep the same project selected in every tab.")}</p>
    <p className="text-sm">{t("Add the addresses below under Authorized redirect URIs. Copy them exactly.")}</p>
    {callbacks.map(item => <div key={item.service} className="space-y-2 rounded-field border border-line p-3">
      <p className="text-sm font-semibold">{item.displayName || item.service}</p>
      <code dir="ltr" className="block break-all text-xs">{item.callbackUrl}</code>
      <Button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(item.callbackUrl); setCopied(item.service); }
        catch { setCopied("failed"); }
      }}>{t("Copy address")}<span className="sr-only"> · {item.service}</span></Button>
    </div>)}
    {copied && <p role="status" className="text-sm">{t(copied === "failed" ? "Copy did not work. Select and copy the address above." : "Address copied.")}</p>}
    {callbacks.some(item => item.defaultScopes?.length) && <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">{t("Permissions to add in Google")}</summary>{callbacks.map(item => <div key={item.service}><p>{item.displayName || item.service}</p><ul>{item.defaultScopes?.map(scope => <li key={scope} dir="ltr" className="break-all font-mono text-xs">{scope}</li>)}</ul></div>)}</details>}
    <p className="text-sm">{t("Client ID and secret stay on this computer, encrypted in the connector. They never go into chat.")}</p>
    <p className="text-sm">{t("While your Google project is in Testing, Google asks you to sign in again every 7 days.")}</p>
    <details className="text-sm">
      <summary className="min-h-11 cursor-pointer py-3">{t("Help with Google sign-in")}</summary>
      <dl className="space-y-2">
        <dt dir="ltr">redirect_uri_mismatch</dt><dd>{t("Open your Web application client and paste the exact addresses above into Authorized redirect URIs. Save and retry.")}</dd>
        <dt dir="ltr">access_denied</dt><dd>{t("In Audience, add the Google email you are signing in with as a test user. Then retry. A work account may also need its administrator’s permission.")}</dd>
        <dt>{t("Google hasn't verified this app")}</dt><dd>{t("This is expected for your own unverified project. Check that the app is yours, then choose Advanced and Go to your app (unsafe), if shown. Continue only for the project you created.")}</dd>
      </dl>
    </details>
  </div>;
}
