"use client";
import { useEffect } from "react";
import { withBase } from "@/lib/paths";

export function InstallableApp() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register(withBase("/sw.js"), { scope: withBase("/"), updateViaCache: "none" }).catch(() => {
        // Online use still works when the browser does not allow offline support.
      });
    }
  }, []);
  return null;
}
