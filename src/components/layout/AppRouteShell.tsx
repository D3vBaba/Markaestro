"use client";

import { usePathname } from "next/navigation";
import AppShell from "./AppShell";

const SHELL_ROUTES = [
  "/dashboard",
  "/products",
  "/content",
  "/calendar",
  "/evergreen",
  "/analytics",
  "/intelligence",
  "/settings",
  "/guides",
];

export default function AppRouteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const usesShell = SHELL_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  return usesShell ? <AppShell>{children}</AppShell> : children;
}
