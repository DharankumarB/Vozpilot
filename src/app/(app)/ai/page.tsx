'use client';

/**
 * VozCore command centre.
 */

import { AIChat } from '@/components/AIChat';
import { NextBestActionPanel } from '@/components/NextBestAction';
import { useApi } from '@/components/hooks';

export default function AIPage() {
  const { data } = useApi<{ profile: { timezone: string } | null }>('/api/profile');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">VozCore</h1>
          <p className="mt-1 text-sm text-text-secondary">
            One orchestration brain coordinating VozGoal, VozProject, VozDay and VozInbox over your real data.
          </p>
        </div>
      </header>

      <NextBestActionPanel timezone={data?.profile?.timezone ?? 'UTC'} />

      <AIChat />
    </div>
  );
}
