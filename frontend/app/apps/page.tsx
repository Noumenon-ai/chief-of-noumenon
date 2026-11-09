import { AuthGate } from "@/components/AuthGate";
import { AppsApp } from "@/components/AppsApp";

export const metadata = { title: "Apps · Chief of Noumenon" };

export default function AppsPage() {
  return (
    <AuthGate>
      <AppsApp />
    </AuthGate>
  );
}
