import ErrorShell from "@/components/shared/ErrorShell";

export default function NotFound() {
  return (
    <ErrorShell
      code="404"
      title="This page got chased off the chart"
      subtitle="The page you're looking for doesn't exist — but Bzila grabbed the green arrow and handled the bears. Pick a direction below."
      // Labels match destinations (they were swapped): /home forwards members
      // to the v3 board and guests to the landing page.
      primary={{ label: "Dashboard", href: "/home" }}
      secondary={{ label: "Home page", href: "/" }}
    />
  );
}
