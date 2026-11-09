import Link from "next/link";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Page not found · Chief of Noumenon", description: "Return to your bots and conversations here." };
export default function NotFound() {
  return <main className="mx-auto flex min-h-[70dvh] max-w-lg flex-col justify-center gap-5 p-6"><p className="font-mono text-muted">404</p><h1 className="text-2xl font-semibold">This page is not here</h1><p className="text-muted">The address may have changed. Your bots and conversations are here.</p><Link href="/chat/" className="rounded-field border border-line bg-raised p-3">Open chat</Link></main>;
}
