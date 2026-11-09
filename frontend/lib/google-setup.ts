// Fixed destinations, never supplied by a model or catalog description.
export const GOOGLE_STEPS = [
  ["Create a Google project", "https://console.cloud.google.com/projectcreate"],
  ["Turn on the Gmail API", "https://console.cloud.google.com/apis/library/gmail.googleapis.com"],
  ["Turn on the Google Calendar API", "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"],
  ["Set up the sign-in screen: choose External", "https://console.cloud.google.com/auth/branding"],
  ["Add your Google email as a test user", "https://console.cloud.google.com/auth/audience"],
  ["Create a client: choose Web application", "https://console.cloud.google.com/auth/clients/create"],
] as const;

export function validGoogleClient(id: string, secret: string, configured = false): boolean {
  if (!id && !secret) return configured;
  return /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id.trim()) &&
    /^GOCSPX-[A-Za-z0-9_-]{20,}$/.test(secret.trim());
}

export function isGoogle(service?: string): boolean {
  return !!service && ["gmail", "googlecalendar", "googledrive", "googlesheets", "googledocs", "googleslides", "googletasks", "googlemeet", "googlechat", "googleforms", "googlephotos", "youtube", "googleads", "googleanalytics", "googlecontacts", "googlebigquery", "googlesearchconsole"].includes(service.replace(/[-_]/g, ""));
}

// Fixed service destinations; unknown services use Google's API library.
export function googleSteps(service: string): readonly (readonly [string, string])[] {
  service = service.replace(/[-_]/g, "");
  if (["gmail", "googlecalendar"].includes(service)) return GOOGLE_STEPS;
  const apis: Record<string, string> = { googledrive: "drive.googleapis.com", googlesheets: "sheets.googleapis.com", googledocs: "docs.googleapis.com", googleslides: "slides.googleapis.com", googletasks: "tasks.googleapis.com", googlemeet: "meet.googleapis.com", googlechat: "chat.googleapis.com", googleforms: "forms.googleapis.com", googlephotos: "photoslibrary.googleapis.com", youtube: "youtube.googleapis.com", googleanalytics: "analyticsdata.googleapis.com", googlebigquery: "bigquery.googleapis.com", googlesearchconsole: "searchconsole.googleapis.com" };
  return [GOOGLE_STEPS[0], ["Turn on this app in the API library", `https://console.cloud.google.com/apis/library/${apis[service] || ""}`],
    ["Choose the permissions this app needs", "https://console.cloud.google.com/auth/scopes"], ...GOOGLE_STEPS.slice(3)];
}
