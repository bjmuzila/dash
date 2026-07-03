import { redirect } from "next/navigation";

// Logs page removed (2026-07-03). Kept as a redirect only because the build
// sandbox couldn't delete the file — safe to delete this whole folder.
export default function LogsPageRemoved() {
  redirect("/owner/dev");
}
