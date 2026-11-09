import { AuthGate } from "@/components/AuthGate";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { AdvancedSettings } from "@/components/settings/AdvancedSettings";
export const metadata = { title: "Advanced · Chief of Noumenon" };
export default function Page() { return <AuthGate><SettingsShell><AdvancedSettings /></SettingsShell></AuthGate>; }
