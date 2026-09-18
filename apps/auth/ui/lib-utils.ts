import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Class names, with Tailwind's conflicts resolved the way the panel resolves them. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
