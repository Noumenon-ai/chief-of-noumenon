import { AuthGate } from "@/components/AuthGate";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { NotificationsSettings } from "@/components/settings/NotificationsSettings";

export default function NotificationsSettingsPage() {
  return <AuthGate><SettingsShell><NotificationsSettings /></SettingsShell></AuthGate>;
}
