import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PageHeader from "@/components/app/PageHeader";
import { Switch } from "@/components/ui/switch";

const automations = [
  "Lead Nurture Sequence",
  "Trial Expiry Reminder",
  "Reactivation Winback",
  "High-Intent Demo Follow-up",
];

export default function AutomationsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Automations"
        subtitle="Control lifecycle flows and trigger-based outreach."
      />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Workflow Toggles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {automations.map((item, i) => (
            <div key={item} className="flex items-center justify-between border-b pb-3 last:border-0">
              <span className="font-medium">{item}</span>
              <Switch defaultChecked={i < 2} />
            </div>
          ))}
        </CardContent>
      </Card>
    </AppShell>
  );
}
