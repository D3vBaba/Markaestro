import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware Link/router/pathname. Split out of routing.ts because
// createNavigation transitively imports next/server, which breaks importing
// routing.ts's plain path-classification helpers from vitest — see the note
// in routing.ts.
export const { Link, usePathname, useRouter } = createNavigation(routing);
