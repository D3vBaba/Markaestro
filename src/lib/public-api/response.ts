import { apiError } from '@/lib/api-response';

export function publicApiError(error: unknown): Response {
  if (error instanceof Response) return error;
  return apiError(error);
}
