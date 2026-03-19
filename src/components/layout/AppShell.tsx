"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useAuth } from "@/components/providers/AuthProvider";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && pathname !== '/login' && pathname !== '/') {
      router.replace('/login');
    }
  }, [loading, user, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary animate-pulse" />
          <div className="space-y-2">
            <div className="h-3 w-32 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-24 rounded-full bg-muted animate-pulse mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-[260px_1fr]">
      <Sidebar className="hidden lg:flex w-[260px]" />
      <div className="flex flex-col min-h-screen bg-background">
        <Header />
        <main className="flex-1 p-4 sm:p-6 lg:p-10 overflow-y-auto">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
