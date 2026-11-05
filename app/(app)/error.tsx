"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card mx-auto mt-12 max-w-md p-6 text-center">
      <h2 className="font-semibold">Something went wrong</h2>
      <p className="mt-1 text-sm text-muted">The page could not be loaded. No changes were lost.</p>
      <button onClick={reset} className="btn btn-primary mt-4">Try again</button>
    </div>
  );
}
