import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui/Toast";
import { LANGUAGE_INIT_SCRIPT } from "@/lib/i18n";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { SettingsShortcutMount } from "@/lib/use-settings-shortcut";
import { BrandBar } from "@/components/shell/BrandBar";
import "./globals.css";
import { InstallableApp } from "@/components/InstallableApp";
import { withBase } from "@/lib/paths";


export const metadata: Metadata = {
  manifest: withBase("/manifest.webmanifest"),
  appleWebApp: { capable: true, title: "Chief", statusBarStyle: "default" },
  icons: { icon: withBase("/icon.svg"), apple: withBase("/apple-touch-icon.png") },
  title: "Chief of Noumenon",
  description: "Run your team of bots, review approvals and work with their computers in one place.",
  openGraph: { title: "Chief of Noumenon", description: "Your bots, conversations and computers. You stay in control.", images: [{ url: "/social.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", images: ["/social.png"] },
};

// Lets pages use the full phone screen; the shell pads for the notch with safe-area insets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#17151c" }],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by the inline script before React hydrates, hence suppressHydrationWarning.
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LANGUAGE_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col"><ToastProvider><SettingsShortcutMount /><InstallableApp /><BrandBar />{children}</ToastProvider></body>
    </html>
  );
}
