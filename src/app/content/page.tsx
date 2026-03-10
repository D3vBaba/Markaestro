"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CreateTab from "./_components/CreateTab";
import DraftsTab from "./_components/DraftsTab";
import ScheduledTab from "./_components/ScheduledTab";
import PublishedTab from "./_components/PublishedTab";

export default function PublishPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handlePostCreated = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <AppShell>
      <PageHeader
        title="Publish"
        subtitle="Generate AI content and publish directly to social platforms."
      />

      <Tabs defaultValue="create" className="space-y-6">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="create">Create</TabsTrigger>
          <TabsTrigger value="drafts">Drafts</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
          <TabsTrigger value="published">Published</TabsTrigger>
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
      </Tabs>
    </AppShell>
  );
}
