import { AuthGate } from "@/components/AuthGate";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { DaySettings } from "@/components/settings/DaySettings";
export const metadata = { title: "Your day · Chief of Noumenon" };
export default function Page() { return <AuthGate><SettingsShell><DaySettings /></SettingsShell></AuthGate>; }
