export function ErrorComponent({ error }: { error: Error }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-surface p-6 text-center">
        <h1 className="text-lg font-medium text-fg">خطا</h1>
        <p className="mt-2 text-sm text-muted">{error.message}</p>
      </div>
    </div>
  );
}
