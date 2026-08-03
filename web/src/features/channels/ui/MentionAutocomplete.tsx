import type { DmCandidate } from "../dm-candidates";

export function MentionAutocomplete({
  onSelect,
  selectedIndex,
  suggestions,
}: {
  onSelect: (candidate: DmCandidate) => void;
  selectedIndex: number;
  suggestions: DmCandidate[];
}) {
  if (!suggestions.length) return null;
  return (
    <div
      aria-label="Mention suggestions"
      className="absolute bottom-full left-2 z-20 mb-2 max-h-64 w-[min(24rem,calc(100vw-3rem))] overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground shadow-lg"
      role="listbox"
    >
      {suggestions.map((candidate, index) => (
        <button
          aria-label={`Mention ${candidate.displayName}`}
          aria-selected={index === selectedIndex}
          className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted ${
            index === selectedIndex ? "bg-muted" : ""
          }`}
          key={candidate.pubkey}
          onClick={() => onSelect(candidate)}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          type="button"
        >
          <span className="min-w-0 flex-1 truncate text-sm">
            {candidate.displayName}
          </span>
          {candidate.isAgent ? (
            <span className="text-xs text-muted-foreground">agent</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
