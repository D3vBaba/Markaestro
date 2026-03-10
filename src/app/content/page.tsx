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
        <TabsList className="bg-muted/30 p-1 rounded-xl">
          <TabsTrigger value="create">Create</TabsTrigger>
          <TabsTrigger value="drafts">Drafts</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
          <TabsTrigger value="published">Published</TabsTrigger>
          <TabsTrigger value="gallery">Gallery</TabsTrigger>
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
      </Tabs>
    </AppShell>
  );
}
