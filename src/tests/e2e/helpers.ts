import { fileURLToPath } from "node:url";

/** Resolve a fixture HTML file to a file:// URL for page.goto(). */
export function fixtureUrl(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)).replace(
    /^/,
    "file://",
  );
}
