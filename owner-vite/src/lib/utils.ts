/**
 * shadcn's class helper.
 *
 * It used to import `clsx` and `tailwind-merge`, neither of which is in
 * package.json — they came with the Bklit chart components that were never
 * vendored (src/components/charts/index.ts is still `export {}`). Nothing in the
 * app imports this file; it is kept, dependency-free, so the two `Cannot find
 * module` errors stay gone whether or not those packages ever arrive.
 */
export type ClassValue = string | number | null | false | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue) => {
    if (!v && v !== 0) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    out.push(String(v));
  };
  inputs.forEach(walk);
  return out.join(" ");
}

/** "5m ago" / "3d ago" / a date past 30 days. Shared with customerPanels.tsx. */
export function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
