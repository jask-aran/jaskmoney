import { clsx, type ClassValue } from "clsx"

/** Class names joined (Conduit's @/lib/utils cn). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
