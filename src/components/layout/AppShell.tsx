import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

export default function AppShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="grid min-h-screen w-full lg:grid-cols-[260px_1fr]">
            <Sidebar className="hidden lg:flex w-[260px]" />
            <div className="flex flex-col min-h-screen bg-background/50 relative">
                <Header />
                <main className="flex-1 p-6 lg:p-10 z-10 overflow-y-auto">
                    {children}
                </main>
            </div>
        </div>
    );
}
