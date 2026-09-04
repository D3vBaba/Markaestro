import testimonials from "@/content/testimonials.json";

type Testimonial = { quote: string; name: string; role?: string; source?: string };

/** Renders nothing until real quotes exist in src/content/testimonials.json. */
export default function WallOfLove({ title }: { title: string }) {
  const items = (testimonials.items as Testimonial[]) ?? [];
  if (items.length === 0) return null;
  return (
    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
      <h2 className="m-0 text-center text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{title}</h2>
      <div className="mt-12 columns-1 gap-5 sm:columns-2 lg:columns-3">
        {items.map((item) => (
          <figure key={item.quote} className="mb-5 break-inside-avoid rounded-2xl border border-border bg-card p-6">
            <blockquote className="m-0 text-[15px] leading-6 text-mk-ink-80">{item.quote}</blockquote>
            <figcaption className="mt-4 text-sm">
              <span className="font-semibold text-foreground">{item.name}</span>
              {item.role ? <span className="text-muted-foreground"> · {item.role}</span> : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
