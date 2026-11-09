"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { request } from "@/lib/api";
import type { LocalCatalog } from "@/components/LocalApps";
import { ContactSettings } from "./ContactSettings";
import { PostDraftSettings } from "./PostDraftSettings";
export function AdvancedSettings() {
  const [catalog, setCatalog] = useState<LocalCatalog | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; request<LocalCatalog>("/integrations/connector").then(value => { if (live) setCatalog(value); }).catch(() => { if (live) setError("Could not check connected apps. Try again on the Apps page."); }); return () => { live = false; }; }, []);
  const connected = (names: string[]) => catalog?.connections.some(c => names.includes(c.service) && ["active", "added"].includes(c.status));
  return <div className="space-y-6">
    {error && <p role="alert">{error}</p>}
    {!catalog && !error && <p role="status">Checking connected apps…</p>}
    <span id="setting-advanced-contacts" /><span id="setting-advanced-drafts" />
    {catalog && <>
      {connected(["hubspot", "front"]) ? <ContactSettings /> : <p>For contact aliases, <Link href="/apps/" className="underline">connect HubSpot or Front in Apps</Link>.</p>}
      {connected(["twitter", "x", "linkedin", "bluesky", "mastodon"]) ? <PostDraftSettings /> : <p>For post drafts, <Link href="/apps/" className="underline">connect X, LinkedIn, Bluesky or Mastodon in Apps</Link>.</p>}
    </>}
  </div>;
}
