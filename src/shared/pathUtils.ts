/** Last path segment, handling both forward-slash and backslash separators. */
export function getBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
