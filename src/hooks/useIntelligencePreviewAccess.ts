"use client";

import { useAuth } from '@/components/providers/AuthProvider';
import { canAccessIntelligencePreview } from '@/lib/intelligence/preview-access';

export function useIntelligencePreviewAccess(): boolean {
  const { user } = useAuth();
  return canAccessIntelligencePreview({ email: user?.email, uid: user?.uid });
}
