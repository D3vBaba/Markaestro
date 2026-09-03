import type { Metadata } from "next";
import NotFoundClient from "./not-found-client";

export const metadata: Metadata = {
  title: "Page not found | Markaestro",
  robots: { index: false, follow: false },
};

export default NotFoundClient;
