import { AuthGate } from "@/components/AuthGate";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { PhoneSettings } from "@/components/settings/PhoneSettings";

export const metadata = { title: "Use on your phone · Chief of Noumenon" };

export default function Page() {
  return <AuthGate><SettingsShell><PhoneSettings /></SettingsShell></AuthGate>;
}
