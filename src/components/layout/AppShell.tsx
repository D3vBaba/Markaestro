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
    if (!loading && !user && pathname !== '/login') {
      router.replace('/login');
    }
  }, [loading, user, pathname, router]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading session...</div>;
  }

  if (!user) return null;

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-[260px_1fr]">
      <Sidebar className="hidden lg:flex w-[260px]" />
      <div className="flex flex-col min-h-screen bg-background/50 relative">
        <Header />
        <main className="flex-1 p-6 lg:p-10 z-10 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
