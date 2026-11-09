"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function TasksPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/chat/"); }, [router]);
  return <main className="p-6"><Link href="/chat/">Open chat</Link></main>;
}
