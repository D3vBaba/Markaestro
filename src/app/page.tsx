import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail, MousePointerClick, TrendingUp, ArrowUpRight, ArrowDownRight, Activity } from "lucide-react";
import { DashboardOverviewChart } from "@/components/dashboard/OverviewChart";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <AppShell>
      <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0 mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h2>
          <p className="text-muted-foreground mt-1">Welcome back to Markaestro.</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="outline" className="bg-background">Export</Button>
          <Button>New Campaign</Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Contacts</CardTitle>
            <Users className="h-4 w-4 text-foreground opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">12,345</div>
            <p className="text-xs text-muted-foreground flex items-center mt-2 font-medium">
              <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-sm mr-2">
                <ArrowUpRight className="h-3 w-3 mr-0.5" /> 18%
              </span>
              vs last month
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Emails Sent</CardTitle>
            <Mail className="h-4 w-4 text-foreground opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">45,231</div>
            <p className="text-xs text-muted-foreground flex items-center mt-2 font-medium">
              <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-sm mr-2">
                <ArrowUpRight className="h-3 w-3 mr-0.5" /> 20.1%
              </span>
              vs last month
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Rate</CardTitle>
            <MousePointerClick className="h-4 w-4 text-foreground opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">24.5%</div>
            <p className="text-xs text-muted-foreground flex items-center mt-2 font-medium">
              <span className="text-rose-600 flex items-center bg-rose-50 px-1.5 py-0.5 rounded-sm mr-2">
                <ArrowDownRight className="h-3 w-3 mr-0.5" /> 2%
              </span>
              vs last month
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Now</CardTitle>
            <TrendingUp className="h-4 w-4 text-foreground opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">573</div>
            <p className="text-xs text-muted-foreground flex items-center mt-2 font-medium">
              <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-sm mr-2">
                <Activity className="h-3 w-3 mr-1" /> Live
              </span>
              +201 since last hour
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7 mt-6">
        <Card className="col-span-4 shadow-sm">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>Email engagement statistics for the last 7 days.</CardDescription>
          </CardHeader>
          <CardContent className="pl-0">
            <DashboardOverviewChart />
          </CardContent>
        </Card>
        <Card className="col-span-3 shadow-sm">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest campaign interactions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {[
                { user: "Sarah Smith", action: "Opened", campaign: "Welcome Series #1", time: "2m ago", initials: "SS" },
                { user: "Mike Johnson", action: "Clicked", campaign: "Product Update v2", time: "15m ago", initials: "MJ" },
                { user: "Emily Davis", action: "Subscribed", campaign: "Organic Search", time: "1h ago", initials: "ED" },
                { user: "Alex Wilson", action: "Bounced", campaign: "Re-engagement Flow", time: "2h ago", initials: "AW" },
              ].map((item, i) => (
                <div key={i} className="flex items-start justify-between group">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9 border border-border bg-muted">
                      <AvatarFallback className="text-xs font-medium text-foreground">{item.initials}</AvatarFallback>
                    </Avatar>
                    <div className="grid gap-1">
                      <p className="text-sm font-medium leading-none text-foreground">
                        {item.user}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.campaign}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="secondary" className="text-[10px] font-medium h-5 bg-muted text-foreground hover:bg-muted-foreground/10 border-0">
                      {item.action}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
