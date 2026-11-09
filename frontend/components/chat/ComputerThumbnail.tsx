"use client";
import { Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function ComputerThumbnail({ computerId, name, onOpen, className = "" }: {
  computerId?: number | null; name: string; onOpen: () => void; className?: string;
}) {
  const [picture, setPicture] = useState<string | null>(null);
  useEffect(() => {
    if (!computerId) return;
    let active = true;
    let url: string | null = null;
    const capture = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await api.computerScreenshot(computerId);
        if (!active) { URL.revokeObjectURL(next); return; }
        if (url) URL.revokeObjectURL(url);
        url = next; setPicture(next);
      } catch { if (active) setPicture(null); }
    };
    void capture();
    const timer = setInterval(capture, 15000);
    return () => { active = false; clearInterval(timer); if (url) URL.revokeObjectURL(url); };
  }, [computerId]);
  return <button type="button" className={`computer-preview-button ${className}`} aria-label={`${name}’s computer`} title={`${name}’s computer`} onClick={onOpen}>
    {/* Authenticated blob URLs stay local to this browser. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {picture && <img src={picture} alt={`${name}’s current computer screen`} />}
    {!picture && <Monitor size={22} aria-hidden="true" />}
    <span>{name}’s computer<span>{computerId ? "Take over" : "Open computer setup"}</span></span>
  </button>;
}
