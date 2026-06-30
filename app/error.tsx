"use client";

import { useEffect } from "react";
import ErrorShell from "@/components/shared/ErrorShell";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <ErrorShell
      code="500"
      title="The bears got a hit in"
      subtitle="Something broke on our end. Bzila's regrouping with the green arrow — give it another run."
      primary={{ label: "Try Again", onClick: () => reset() }}
      secondary={{ label: "Back to Home", href: "/home" }}
    />
  );
}
