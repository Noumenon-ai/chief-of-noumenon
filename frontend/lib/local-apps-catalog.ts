export function appCategory(category: string): string {
  const value = category.toLowerCase();
  const groups: Record<string, string> = { productivity: "Productivity", project_management: "Productivity", communication: "Communication", messaging: "Communication", email: "Communication", design: "Design", developer: "Code", development: "Code", code: "Code", data: "Data", database: "Data", storage: "Data", crm: "Sales", sales: "Sales", marketing: "Marketing", media: "Marketing", finance: "Finance", accounting: "Finance", research: "Research", search: "Research", support: "Support", customer_support: "Support" };
  return groups[value] || "Productivity";
}
export function appDescription(app: { service: string; category: string; description: string }): string {
  const descriptions: Record<string, string> = {
    gmail: "Read email and prepare replies; sending asks you first.", googlecalendar: "Read your calendar and arrange events with your approval.",
    github: "Read repositories and issues; changes ask you first.", slack: "Find conversations and send messages with your approval.",
    notion: "Read pages and update them with your approval.", googledrive: "Find files and manage them with your approval.",
  };
  // Generated marketing copy is not evidence of supported abilities.
  return descriptions[app.service.replace(/[-_]/g, "")] || "Connect your account and choose which bots may use it.";
}

const POPULAR = ["gmail", "googlecalendar", "googledrive", "googledocs", "googlesheets", "outlook", "slack", "notion", "github", "microsoftteams", "dropbox", "zoom"];
export function compareApps(a: { service: string; displayName: string }, b: { service: string; displayName: string }): number {
  const rank = (service: string) => { const index = POPULAR.indexOf(service.replace(/[-_]/g, "")); return index < 0 ? POPULAR.length : index; };
  return rank(a.service) - rank(b.service) || a.displayName.localeCompare(b.displayName, "en");
}
export function appColor(service: string): string {
  let hash = 0;
  for (const char of service.replace(/[-_]/g, "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(--identity-${hash % 10 + 1})`;
}
export function preferredAuth(types: string[], browserSignIn: boolean): string {
  return browserSignIn || types.includes("oauth2") ? "oauth2" : types[0] || "api_key";
}
export function credentialLabel(field: { key: string; label?: string }, provider: string): string {
  const label = field.label || field.key;
  const names: Record<string, string> = { apiKey: "Account key", api_key: "Account key", accessToken: "Access token", bearerToken: "Access token", token: "Access token", domain: "Domain", subdomain: "Subdomain", accountId: "Account ID", username: "Username", password: "Password" };
  if (/^(api[ _]?key|bearer[ _]?token|api key or token)$/i.test(label)) return `${provider} ${/key/i.test(label) ? "account key" : "access token"}`;
  return field.label || names[field.key] || field.key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}
