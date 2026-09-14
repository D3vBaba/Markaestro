import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type FeatureRow = {
  feature: string;
  subtext: string;
  traditional: boolean | string;
  autopost: boolean | string;
  markaestro: boolean | string;
};

const ROWS: FeatureRow[] = [
  {
    feature: "Evergreen Post Recycling",
    subtext: "Keeps winning content in circulation",
    traditional: "Manual only",
    autopost: "Basic repeat loop",
    markaestro: "Intelligent with decay shutoff",
  },
  {
    feature: "Variant Rotation",
    subtext: "Use approved variations when reposting",
    traditional: false,
    autopost: false,
    markaestro: true,
  },
  {
    feature: "Audience-Learned Best Times",
    subtext: "Uses available audience and post performance data",
    traditional: "Choose times manually",
    autopost: "Fixed cadence only",
    markaestro: "Platform direct APIs",
  },
  {
    feature: "Performance Decay Protection",
    subtext: "Auto-pauses recycling when engagement drops",
    traditional: false,
    autopost: false,
    markaestro: true,
  },
  {
    feature: "True Multi-Brand Isolation",
    subtext: "Separate channels, voices, and media vaults",
    traditional: "Organize files manually",
    autopost: "Flat workspace",
    markaestro: "Scoped brand access",
  },
  {
    feature: "Model Context Protocol (MCP)",
    subtext: "Native AI agent tool execution",
    traditional: false,
    autopost: "Separate integration",
    markaestro: "Local and hosted MCP",
  },
  {
    feature: "Human in the Loop Guardrails",
    subtext: "Opt-in auto-publish with review defaults",
    traditional: "All manual",
    autopost: "Review rules vary",
    markaestro: "Manual-first safe delivery",
  },
];

export default function CompetitorComparison() {
  return (
    <section className="border-t border-border bg-card/30 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="accent" className="px-3 py-1 text-xs font-semibold uppercase tracking-wider">
            Compare Publishing Workflows
          </Badge>
          <h2 className="m-0 mt-4 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            From Manual Publishing to Measured Reuse
          </h2>
          <p className="m-0 mx-auto mt-4 max-w-2xl text-base leading-7 text-mk-ink-80 sm:text-lg">
            Compare manual scheduling, fixed repeat schedules, and Markaestro’s tools. Capabilities in other products vary.
          </p>
        </div>

        {/* Comparison Table */}
        <div className="mt-14 overflow-x-auto rounded-3xl border border-border bg-background shadow-lg">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="p-5 sm:p-6 font-semibold text-foreground w-2/5">
                  Capability
                </th>
                <th className="p-5 sm:p-6 font-semibold text-muted-foreground w-1/5 text-center">
                  Manual Workflow
                </th>
                <th className="p-5 sm:p-6 font-semibold text-muted-foreground w-1/5 text-center">
                  Fixed Repeat Workflow
                </th>
                <th className="p-5 sm:p-6 font-bold text-mk-accent w-1/5 text-center bg-mk-accent-soft/50 border-l border-r border-mk-accent/20">
                  Markaestro
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ROWS.map((row) => (
                <tr key={row.feature} className="transition-colors hover:bg-muted/20">
                  <td className="p-5 sm:p-6">
                    <p className="font-bold text-foreground text-sm">{row.feature}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{row.subtext}</p>
                  </td>

                  {/* Traditional */}
                  <td className="p-5 sm:p-6 text-center">
                    {typeof row.traditional === "boolean" ? (
                      row.traditional ? (
                        <Check className="mx-auto size-4 text-muted-foreground" />
                      ) : (
                        <X className="mx-auto size-4 text-muted-foreground/40" />
                      )
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        {row.traditional}
                      </span>
                    )}
                  </td>

                  {/* Auto-posters */}
                  <td className="p-5 sm:p-6 text-center">
                    {typeof row.autopost === "boolean" ? (
                      row.autopost ? (
                        <Check className="mx-auto size-4 text-muted-foreground" />
                      ) : (
                        <X className="mx-auto size-4 text-muted-foreground/40" />
                      )
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        {row.autopost}
                      </span>
                    )}
                  </td>

                  {/* Markaestro */}
                  <td className="p-5 sm:p-6 text-center bg-mk-accent-soft/30 border-l border-r border-mk-accent/20">
                    {typeof row.markaestro === "boolean" ? (
                      row.markaestro ? (
                        <div className="inline-flex size-6 items-center justify-center rounded-full bg-mk-accent text-white">
                          <Check className="size-3.5 stroke-[3]" />
                        </div>
                      ) : (
                        <X className="mx-auto size-4 text-muted-foreground/40" />
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-mk-accent-soft px-3 py-1 text-xs font-bold text-mk-accent">
                        {row.markaestro}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
