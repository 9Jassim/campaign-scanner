/**
 * Skeleton shown while the dashboard's queries run. Mirrors the page layout:
 * four stat cards, two charts side by side, a table, and the heatmap.
 */
export default function AnalyticsLoading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <div className="h-8 w-40 animate-pulse rounded bg-black/10 dark:bg-white/10" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl bg-black/[.06] dark:bg-white/[.06]"
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-xl bg-black/[.06] dark:bg-white/[.06]" />
        <div className="h-72 animate-pulse rounded-xl bg-black/[.06] dark:bg-white/[.06]" />
      </div>

      <div className="h-64 animate-pulse rounded-xl bg-black/[.06] dark:bg-white/[.06]" />
      <div className="h-56 animate-pulse rounded-xl bg-black/[.06] dark:bg-white/[.06]" />
    </main>
  );
}
