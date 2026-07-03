import { redirect } from "next/navigation";

// Personal landing removed (2026-07-03). To-Do (/owner/personal/todo) remains.
// Kept as a redirect only because the build sandbox couldn't delete the file.
export default function PersonalRemoved() {
  redirect("/owner/personal/todo");
}
