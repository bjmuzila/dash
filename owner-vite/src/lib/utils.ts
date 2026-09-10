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
