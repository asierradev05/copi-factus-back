export function useInMemoryFallback(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const override = process.env.ALLOW_IN_MEMORY_FALLBACK;
  if (override !== undefined) {
    return override.toLowerCase() === 'true';
  }
  return true;
}
