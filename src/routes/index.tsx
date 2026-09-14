import { createFileRoute } from "@tanstack/react-router";
import { SeoStudio } from "@/components/seo-studio";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <SeoStudio />;
}
