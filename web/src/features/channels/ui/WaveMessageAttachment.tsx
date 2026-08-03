import { Button } from "@/shared/ui/button";

export function WaveMessageAttachment({
  fallbackText,
  huddlePending = false,
  onStartHuddle,
}: {
  fallbackText: string;
  huddlePending?: boolean;
  onStartHuddle?: () => void;
}) {
  return (
    <div
      className="buzz-wave-hover-trigger mt-1 grid max-w-md min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 overflow-hidden rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/50 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]"
      data-testid="message-wave-attachment"
    >
      <div
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background text-lg text-muted-foreground"
      >
        <span className="buzz-wave-hand">👋</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold leading-5 text-foreground sm:truncate">
          {fallbackText}
        </p>
        <p className="break-words text-xs leading-4 text-muted-foreground sm:truncate">
          Start a huddle to talk to them.
        </p>
      </div>
      {onStartHuddle ? (
        <Button
          className="relative z-10 col-start-2 justify-self-start text-muted-foreground sm:col-start-3 sm:row-start-1 sm:justify-self-end"
          disabled={huddlePending}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartHuddle();
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {huddlePending ? "Starting..." : "Start huddle"}
        </Button>
      ) : null}
    </div>
  );
}
