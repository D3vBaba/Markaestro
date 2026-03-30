"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Select from "@/components/app/Select";
import CreateTab from "./_components/CreateTab";
import DraftsTab from "./_components/DraftsTab";
import ScheduledTab from "./_components/ScheduledTab";
import PublishedTab from "./_components/PublishedTab";
import ImageGallery from "./_components/ImageGallery";
import PerformanceTab from "./_components/PerformanceTab";
import TikTokVideoTab from "./_components/TikTokVideoTab";
import ApprovalsTab from "./_components/ApprovalsTab";
import { FeatureGate } from "@/components/app/FeatureGate";

const tabs = [
  { value: "create", label: "Create" },
  { value: "tiktok video", label: "TikTok Video" },
  { value: "drafts", label: "Drafts" },
  { value: "approvals", label: "Approvals" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "gallery", label: "Gallery" },
  { value: "performance", label: "Performance" },
] as const;

export default function PostsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState("create");

  const handlePostCreated = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <AppShell>
      <PageHeader
        title="Posts"
        subtitle="Create, schedule, and publish organic content across your social channels."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8 min-w-0 w-full">
        {/* Mobile: dropdown select */}
        <div className="sm:hidden">
          <Select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value)}
          >
            {tabs.map((tab) => (
              <option key={tab.value} value={tab.value}>
                {tab.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Desktop: tab bar */}
        <TabsList className="hidden sm:flex bg-transparent border-b border-border/40 rounded-none p-0 h-auto gap-0 w-full">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 text-sm font-medium tracking-wide uppercase text-muted-foreground data-[state=active]:text-foreground transition-colors whitespace-nowrap"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="create">
          <CreateTab onPostCreated={handlePostCreated} />
        </TabsContent>

        <TabsContent value="tiktok video">
          <TikTokVideoTab onPostCreated={handlePostCreated} />
        </TabsContent>

        <TabsContent value="drafts">
          <DraftsTab refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="approvals">
          <FeatureGate feature="approvalWorkflows">
            <ApprovalsTab refreshKey={refreshKey} />
          </FeatureGate>
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
