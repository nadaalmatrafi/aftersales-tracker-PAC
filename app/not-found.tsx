import Link from "next/link";
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 text-center">
      <div><p className="text-sm text-muted">404</p><h1 className="mt-1 text-lg font-semibold">Not found or not accessible</h1><Link href="/" className="btn btn-secondary mt-4">Back to dashboard</Link></div>
    </main>
  );
}
