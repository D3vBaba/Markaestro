"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CreateTab from "./_components/CreateTab";
import DraftsTab from "./_components/DraftsTab";
import ScheduledTab from "./_components/ScheduledTab";
import PublishedTab from "./_components/PublishedTab";
import ImageGallery from "./_components/ImageGallery";
import PerformanceTab from "./_components/PerformanceTab";

export default function PostsPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handlePostCreated = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <AppShell>
      <PageHeader
        title="Posts"
        subtitle="Create, schedule, and publish organic content across your social channels."
      />

      <Tabs defaultValue="create" className="space-y-8">
        <TabsList className="bg-transparent border-b border-border/40 rounded-none p-0 h-auto gap-0 w-full overflow-x-auto flex-nowrap">
          {["create", "drafts", "scheduled", "published", "gallery", "performance"].map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 sm:px-6 py-3 text-xs sm:text-sm font-medium tracking-wide uppercase text-muted-foreground data-[state=active]:text-foreground transition-colors whitespace-nowrap"
            >
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="create">
          <CreateTab onPostCreated={handlePostCreated} />
        </TabsContent>

        <TabsContent value="drafts">
          <DraftsTab refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="scheduled">
          <ScheduledTab refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="published">
          <PublishedTab refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="gallery">
          <ImageGallery refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="performance">
          <PerformanceTab refreshKey={refreshKey} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
