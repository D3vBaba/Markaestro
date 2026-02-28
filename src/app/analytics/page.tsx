import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import MetricCard from "@/components/app/MetricCard";

const metrics = [
  { label: "Pipeline Revenue", value: "$128,420" },
  { label: "CAC", value: "$38.12" },
  { label: "Lead-to-Trial", value: "14.8%" },
  { label: "Trial-to-Paid", value: "21.4%" },
];

export default function AnalyticsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Analytics"
        subtitle="Track growth outcomes and channel efficiency."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m, idx) => (
          <MetricCard key={m.label} label={m.label} value={m.value} delta={idx % 2 === 0 ? 12 : -3} />
        ))}
      </div>
    </AppShell>
  );
}
