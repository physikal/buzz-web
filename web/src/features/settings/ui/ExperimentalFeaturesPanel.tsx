import { desktopFeatures, useFeatureToggle } from "@/shared/features";

function FeatureRow({
  feature,
}: {
  feature: (typeof desktopFeatures)[number];
}) {
  const [enabled, toggle] = useFeatureToggle(feature.id);
  const inputId = `feature-toggle-${feature.id}`;
  return (
    <label
      className="flex items-center justify-between gap-3 rounded-md border px-4 py-3"
      htmlFor={inputId}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{feature.name}</span>
        <span className="block text-xs text-muted-foreground">
          {feature.description}
        </span>
      </span>
      <input
        checked={enabled}
        className="h-4 w-4 shrink-0 accent-primary"
        data-testid={inputId}
        id={inputId}
        onChange={(event) => toggle(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

export function ExperimentalFeaturesPanel() {
  return (
    <section data-testid="settings-experimental">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Experiments</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These features are functional but still being refined. Enable them to
          try new capabilities early.
        </p>
      </header>
      <div className="flex flex-col gap-2">
        {desktopFeatures.map((feature) => (
          <FeatureRow feature={feature} key={feature.id} />
        ))}
      </div>
    </section>
  );
}
