"use client";
import { useT as useUiText } from "@/lib/use-i18n";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ErrorState, LoadingState } from "@/components/chat/PanelState";
import { SettingsCard } from "./SettingsCard";
import { Switch } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import { Applies } from "./Applies";
import { SavedConfirmation, useSavedConfirmation } from "./SavedConfirmation";
import { api, type NotificationPreferences } from "@/lib/api";
import {
  canRequestBrowserPermission,
  isDesktopApp,
  playNotificationSound,
  requestNotificationPermission,
  showNotificationAlert,
} from "@/lib/desktop-notifications";

const defaultPrefs: NotificationPreferences = {
  desktop_enabled: true,
  notify_needs_you: true,
  notify_failures: true,
  notify_task_due: true,
  notify_turn_completed: true,
  sound_enabled: false,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "08:00",
};

function getNotificationPermissionSnapshot(): NotificationPermission {
  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.permission;
  }
  return "default";
}

function subscribeToPermission(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("focus", callback);
  return () => window.removeEventListener("focus", callback);
}

export function NotificationsSettings() {
  const tx = useUiText();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadTick, setLoadTick] = useState(0);
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultPrefs);
  const browserPermission = useSyncExternalStore(
    subscribeToPermission,
    getNotificationPermissionSnapshot,
    () => "default" as NotificationPermission,
  );
  const [testSent, setTestSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const confirmation = useSavedConfirmation();

  useEffect(() => {
    let alive = true;
    api.getNotificationPreferences().then((loaded) => {
      if (alive) { setPrefs(loaded); setLoaded(true); setLoadError(false); }
    }).catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [loadTick]);

  const saveOption = async <K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => {
    if (saving) return;
    const previous = prefs;
    const updated = { ...prefs, [key]: value };
    setPrefs(updated); setSaving(true); setSaveError("");
    try {
      await api.updateNotificationPreferences(updated);
      confirmation.showSaved(key);
    } catch {
      setPrefs(previous);
      setSaveError("Could not save notification settings. Your previous choices are still in use. Try again.");
    } finally { setSaving(false); }
  };

  const handleRequestPermission = async () => {
    await requestNotificationPermission();
    window.dispatchEvent(new Event("focus"));
  };

  const handleTestNotification = () => {
    if (prefs.sound_enabled) {
      playNotificationSound();
    }
    const success = showNotificationAlert({
      title: "Chief of Noumenon Notification",
      body: "Desktop notifications are working! You will be alerted when bots need you or routines fail.",
      silent: !prefs.sound_enabled,
    });
    if (success) {
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    }
  };

  const browserReady = useSyncExternalStore(subscribeToPermission, () => true, () => false);
  const isDesktop = browserReady && isDesktopApp();

  if (loadError) return <ErrorState message={tx("Could not load notification settings.")} onRetry={() => { setLoadError(false); setLoadTick(value => value + 1); }} />;
  if (!loaded) return <LoadingState rows={3} />;
  return (
    <div className="space-y-6" data-setting-root data-setting-container tabIndex={-1}>
      {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
      <div id="setting-notifications-desktop" data-setting-id="setting-notifications-desktop" data-setting-container tabIndex={-1}>
        <SettingsCard
          title={tx("Desktop notifications")}
          description={tx("Receive native operating system alerts when bots need your input or background tasks encounter issues.")}
          action={
            <Button size="sm" variant="secondary" onClick={handleTestNotification}>
              {testSent ? tx("Test sent!") : tx("Send test alert")}
            </Button>
          }
        >
          <div className="space-y-3">
            <Switch
              label={tx("Enable desktop notifications")}
              description={tx("Show OS notifications when Chief of Noumenon is running in the background.")}
              disabled={saving}
              checked={prefs.desktop_enabled}
              onChange={(e) => saveOption("desktop_enabled", e.target.checked)}
            />

            {browserReady && !isDesktop && canRequestBrowserPermission() && browserPermission !== "granted" && (
              <div className="flex items-center justify-between rounded-field border border-line bg-surface p-3 text-xs">
                <span className="text-muted">
                  {tx("Browser notification permission is currently")}{" "}<strong>{browserPermission}</strong>.
                </span>
                <Button size="sm" onClick={handleRequestPermission}>
                  {tx("Allow notifications")}</Button>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Applies when="now" />
              <SavedConfirmation visible={confirmation.saved.has("desktop_enabled")} />
            </div>
          </div>
        </SettingsCard>
      </div>

      <div id="setting-notifications-categories" data-setting-id="setting-notifications-categories" data-setting-container tabIndex={-1}>
        <SettingsCard
          title={tx("What notifies you")}
          description={tx("Choose which categories of bot events should trigger desktop alerts.")}
        >
          <div className="space-y-4">
            <Switch
              label={tx("Bot input & approvals")}
              description={tx("Notify when a bot asks a question, requests tool approval, or needs human guidance.")}
              disabled={saving || !prefs.desktop_enabled}
              checked={prefs.notify_needs_you}
              onChange={(e) => saveOption("notify_needs_you", e.target.checked)}
            />

            <Switch
              label={tx("Failures & errors")}
              description={tx("Notify when a background routine or delegated task fails or encounters an unhandled error.")}
              disabled={saving || !prefs.desktop_enabled}
              checked={prefs.notify_failures}
              onChange={(e) => saveOption("notify_failures", e.target.checked)}
            />

            <Switch
              label={tx("Task deadlines & reminders")}
              description={tx("Notify when a scheduled task reaches its reminder deadline.")}
              disabled={saving || !prefs.desktop_enabled}
              checked={prefs.notify_task_due}
              onChange={(e) => saveOption("notify_task_due", e.target.checked)}
            />

            <Switch
              label="Bot responses & completions"
              description="Notify when an bot completes a reply while Chief of Noumenon is in the background or minimized."
              disabled={!prefs.desktop_enabled}
              checked={prefs.notify_turn_completed ?? true}
              onChange={(e) => saveOption("notify_turn_completed", e.target.checked)}
            />

            <div className="flex items-center gap-3 pt-1">
              <Applies when="now" />
              <SavedConfirmation
                visible={
                  confirmation.saved.has("notify_needs_you") ||
                  confirmation.saved.has("notify_failures") ||
                  confirmation.saved.has("notify_task_due") ||
                  confirmation.saved.has("notify_turn_completed")
                }
              />
            </div>
          </div>
        </SettingsCard>
      </div>

      <div id="setting-notifications-sound" data-setting-id="setting-notifications-sound" data-setting-container tabIndex={-1}>
        <SettingsCard
          title={tx("Alert sound")}
          description={tx("Control audio alerts accompanying desktop notifications.")}
        >
          <div className="space-y-3">
            <Switch
              label={tx("Notification chime")}
              description={tx("Play a subtle chime sound when a desktop notification arrives.")}
              disabled={saving || !prefs.desktop_enabled}
              checked={prefs.sound_enabled}
              onChange={(e) => saveOption("sound_enabled", e.target.checked)}
            />

            <div className="flex items-center gap-3 pt-1">
              <Applies when="now" />
              <SavedConfirmation visible={confirmation.saved.has("sound_enabled")} />
            </div>
          </div>
        </SettingsCard>
      </div>

      <div id="setting-notifications-quiet" data-setting-id="setting-notifications-quiet" data-setting-container tabIndex={-1}>
        <SettingsCard
          title={tx("Quiet hours")}
          description="Automatically silence desktop alerts and chime sounds during your chosen resting hours."
        >
          <div className="space-y-4">
            <Switch
              label="Enable quiet hours"
              description="Do not disturb during scheduled hours."
              disabled={!prefs.desktop_enabled}
              checked={prefs.quiet_hours_enabled ?? false}
              onChange={(e) => saveOption("quiet_hours_enabled", e.target.checked)}
            />

            {(prefs.quiet_hours_enabled ?? false) && (
              <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
                <label className="flex items-center gap-2">
                  <span className="text-muted">{tx("From:")}</span>
                  <input
                    type="time"
                    disabled={!prefs.desktop_enabled}
                    value={prefs.quiet_hours_start ?? "22:00"}
                    onChange={(e) => saveOption("quiet_hours_start", e.target.value)}
                    className="rounded-field border border-line bg-surface px-2.5 py-1 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-muted">{tx("To:")}</span>
                  <input
                    type="time"
                    disabled={!prefs.desktop_enabled}
                    value={prefs.quiet_hours_end ?? "08:00"}
                    onChange={(e) => saveOption("quiet_hours_end", e.target.value)}
                    className="rounded-field border border-line bg-surface px-2.5 py-1 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Applies when="now" />
              <SavedConfirmation
                visible={
                  confirmation.saved.has("quiet_hours_enabled") ||
                  confirmation.saved.has("quiet_hours_start") ||
                  confirmation.saved.has("quiet_hours_end")
                }
              />
            </div>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}