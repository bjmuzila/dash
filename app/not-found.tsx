import ErrorShell from "@/components/shared/ErrorShell";

export default function NotFound() {
  return (
    <ErrorShell
      code="404"
      title="This page got chased off the chart"
      subtitle="The page you're looking for doesn't exist — but Bzila grabbed the green arrow and handled the bears. Pick a direction below."
      primary={{ label: "Back to Home", href: "/home" }}
      secondary={{ label: "Dashboard", href: "/" }}
    />
  );
}
