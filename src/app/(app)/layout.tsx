import { AuthProvider } from "@/components/providers/AuthProvider";
import { SubscriptionProvider } from "@/components/providers/SubscriptionProvider";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";

/**
 * Layout for the application surface (app.markaestro.com).
 *
 * The Firebase-backed providers live here rather than in the root layout so
 * that only authenticated app routes initialise the Firebase client SDK and
 * its auth listener. Marketing pages in the (marketing) group are
 * intentionally provider-free.
 */
export default function AppGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <SubscriptionProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </SubscriptionProvider>
    </AuthProvider>
  );
}
