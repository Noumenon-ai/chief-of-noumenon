import { AuthGate } from "@/components/AuthGate";
import { MarketplaceApp } from "@/components/MarketplaceApp";

export const metadata = { title: "More tools · Chief of Noumenon" };

export default function MarketplacePage() {
  return <AuthGate><MarketplaceApp /></AuthGate>;
}
