export function supportError(error: unknown, fallback: string): string {
  const response = (error as { response?: { headers?: Record<string, string>; data?: { error?: { correlationId?: string } } } })?.response;
  const reference = response?.data?.error?.correlationId || response?.headers?.['x-correlation-id'];
  // Only show server-generated UUIDs, not arbitrary content from an upstream error.
  return reference && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reference)
    ? `${fallback} Reference: ${reference}`
    : fallback;
}