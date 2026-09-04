import { Label } from "@/components/ui/label";

/**
 * Label above, control, helper or error below. Errors render in the
 * semantic negative colour and are announced with aria-live.
 */
export default function FormField({
  label,
  description,
  error,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  description?: string;
  error?: string | null;
  htmlFor?: string;
  optional?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional ? <span className="text-xs text-mk-ink-40">{optional}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-mk-neg" aria-live="polite">{error}</p>
      ) : description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
