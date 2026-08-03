export function ProjectActivityBar({
  commits,
  issues,
  pullRequests,
}: {
  commits: number;
  issues: number;
  pullRequests: number;
}) {
  const total = commits + issues + pullRequests;
  return (
    <div
      aria-label={`${commits} ${commits === 1 ? "commit" : "commits"}, ${pullRequests} ${pullRequests === 1 ? "pull request" : "pull requests"}, ${issues} ${issues === 1 ? "issue" : "issues"}`}
      className="pointer-events-none flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted/60"
      role="img"
    >
      {total ? (
        <>
          {commits ? (
            <span
              className="h-full bg-primary/60"
              style={{ width: `${(commits / total) * 100}%` }}
            />
          ) : null}
          {pullRequests ? (
            <span
              className="h-full bg-primary"
              style={{ width: `${(pullRequests / total) * 100}%` }}
            />
          ) : null}
          {issues ? (
            <span
              className="h-full bg-orange-500"
              style={{ width: `${(issues / total) * 100}%` }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
