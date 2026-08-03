import {
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Users,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { PubkeyAvatar } from "@/features/repos/ui/PubkeyAvatar";
import type { ProjectRepositoryMetadata } from "../project-repository-metadata";
import type { Project } from "../project-api";

const LANGUAGE_DOTS = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-pink-500",
];

function RailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function ProjectOverviewRail({
  branch,
  metadata,
  project,
  pullRequestCount,
  onViewContributors,
}: {
  branch: string;
  metadata: ProjectRepositoryMetadata | undefined;
  project: Project;
  pullRequestCount: number;
  onViewContributors: () => void;
}) {
  const people = [
    ...new Set([project.owner.toLowerCase(), ...project.contributors]),
  ].filter((pubkey) => /^[0-9a-f]{64}$/u.test(pubkey));
  return (
    <aside
      aria-label="Repository overview"
      className="space-y-6 border-t p-4 xl:border-l xl:border-t-0"
    >
      <RailSection title="People">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {people.slice(0, 18).map((pubkey) => (
              <PubkeyAvatar key={pubkey} pubkey={pubkey} size="sm" />
            ))}
          </div>
          <button
            className="shrink-0 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onViewContributors}
            type="button"
          >
            View all
          </button>
        </div>
      </RailSection>
      <RailSection title="Top Languages">
        {metadata?.languages.length ? (
          <div className="flex flex-wrap gap-1.5">
            {metadata.languages.map(([language], index) => (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
                key={language}
              >
                <span
                  className={`h-2 w-2 rounded-full ${LANGUAGE_DOTS[index % LANGUAGE_DOTS.length]}`}
                />
                {language}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No language data is available yet.
          </p>
        )}
      </RailSection>
      <RailSection title="Repository">
        <dl className="space-y-2 text-sm">
          <RepoStat icon={GitBranch} label="Branch" value={branch} />
          <RepoStat
            code
            icon={GitCommitHorizontal}
            label="Latest"
            value={metadata?.latestCommit?.oid.slice(0, 7) ?? "None"}
          />
          <RepoStat
            icon={FileCode2}
            label="Files"
            value={`${metadata?.fileCount ?? 0}${metadata?.filesTruncated ? "+" : ""}`}
          />
          <RepoStat
            icon={Users}
            label="Contributors"
            value={String(metadata?.contributorCount ?? people.length)}
          />
          <RepoStat
            icon={GitPullRequest}
            label="Pull Requests"
            value={String(pullRequestCount)}
          />
        </dl>
      </RailSection>
    </aside>
  );
}

function RepoStat({
  code,
  icon: Icon,
  label,
  value,
}: {
  code?: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </dt>
      <dd className={code ? "font-mono text-xs" : "font-medium"}>{value}</dd>
    </div>
  );
}
