import { ArrowLeft, ChevronRight, File, FileText, Folder } from "lucide-react";
import { useState } from "react";

import { useGitBlob, useGitTree } from "@/features/repos/use-git-browse";
import { RepoBlobPreview } from "@/features/repos/ui/RepoBlobViewer";
import { Button } from "@/shared/ui/button";
import type { Project } from "../project-api";

function joinPath(path: string, name: string) {
  const next = path ? `${path}/${name}` : name;
  return next.length <= 4_096 ? next : null;
}

export function ProjectFilesBrowser({
  project,
  refName,
}: {
  project: Project;
  refName: string;
}) {
  const [path, setPath] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  if (selectedFile) {
    return (
      <ProjectFileContent
        filepath={selectedFile}
        onBack={() => setSelectedFile(null)}
        project={project}
        refName={refName}
      />
    );
  }
  return (
    <ProjectDirectory
      onOpenDirectory={(name) => {
        const next = joinPath(path, name);
        if (next) setPath(next);
      }}
      onOpenFile={(name) => {
        const next = joinPath(path, name);
        if (next) setSelectedFile(next);
      }}
      onPathChange={setPath}
      path={path}
      project={project}
      refName={refName}
    />
  );
}

function ProjectDirectory({
  onOpenDirectory,
  onOpenFile,
  onPathChange,
  path,
  project,
  refName,
}: {
  onOpenDirectory: (name: string) => void;
  onOpenFile: (name: string) => void;
  onPathChange: (path: string) => void;
  path: string;
  project: Project;
  refName: string;
}) {
  const tree = useGitTree(project.owner, project.dtag, refName, path);
  const segments = path ? path.split("/") : [];
  return (
    <>
      <div className="flex min-h-10 min-w-0 items-center gap-1 overflow-x-auto border-b py-2 text-sm">
        <button
          className="shrink-0 font-medium hover:underline"
          onClick={() => onPathChange("")}
          type="button"
        >
          Files
        </button>
        {segments.map((segment, index) => {
          const target = segments.slice(0, index + 1).join("/");
          return (
            <span className="flex shrink-0 items-center gap-1" key={target}>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                className="font-mono hover:underline"
                onClick={() => onPathChange(target)}
                type="button"
              >
                {segment}
              </button>
            </span>
          );
        })}
      </div>
      {tree.isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">Loading files...</p>
      ) : tree.error ? (
        <p className="p-6 text-sm text-destructive">
          Could not load repository files: {tree.error.message}
        </p>
      ) : tree.data?.length ? (
        <div className="divide-y overflow-hidden rounded-md border">
          {tree.data.map((entry) => (
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
              key={`${entry.type}:${entry.name}`}
              onClick={() =>
                entry.type === "tree"
                  ? onOpenDirectory(entry.name)
                  : onOpenFile(entry.name)
              }
              type="button"
            >
              {entry.type === "tree" ? (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <File className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 truncate font-mono">{entry.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="p-6 text-sm text-muted-foreground">
          No files are available on {refName}.
        </p>
      )}
    </>
  );
}

function ProjectFileContent({
  filepath,
  onBack,
  project,
  refName,
}: {
  filepath: string;
  onBack: () => void;
  project: Project;
  refName: string;
}) {
  const blob = useGitBlob(project.owner, project.dtag, refName, filepath);
  return (
    <>
      <div className="flex min-h-10 min-w-0 items-center gap-2 border-b py-2">
        <Button
          aria-label="Back to files"
          onClick={onBack}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-sm">{filepath}</span>
      </div>
      <div className="mt-4">
        {blob.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading file...</p>
        ) : blob.error ? (
          <p className="text-sm text-destructive">
            Could not load file: {blob.error.message}
          </p>
        ) : blob.data ? (
          <RepoBlobPreview
            filepath={filepath}
            owner={project.owner}
            refName={refName}
            repoName={project.dtag}
            view={blob.data}
          />
        ) : null}
      </div>
    </>
  );
}
