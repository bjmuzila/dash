import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** shadcn's class helper — only used by the Bklit chart components. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
