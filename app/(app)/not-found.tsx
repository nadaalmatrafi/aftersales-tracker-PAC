import Link from "next/link";
export default function NotFound() {
  return (
    <div className="card mx-auto mt-12 max-w-md p-6 text-center">
      <p className="text-sm text-muted">404</p>
      <h1 className="mt-1 text-lg font-semibold">Not found or not accessible</h1>
      <p className="mt-1 text-sm text-muted">The record does not exist or your role does not have access to it.</p>
      <Link href="/" className="btn btn-secondary mt-4">Back to dashboard</Link>
    </div>
  );
}
