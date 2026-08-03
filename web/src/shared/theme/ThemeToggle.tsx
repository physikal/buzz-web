import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { Button } from "@/shared/ui/button";

export function ThemeToggle() {
  const { followSystem, isDark, selectedThemeName, setFollowSystem, setTheme } =
    useTheme();
  const Icon = followSystem ? Monitor : isDark ? Moon : Sun;
  const label = followSystem ? "system" : isDark ? "dark" : "light";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={() => {
        if (followSystem) {
          setFollowSystem(false);
          setTheme(isDark ? "buzz-dark" : "buzz");
        } else if (!isDark) {
          setTheme("buzz-dark");
        } else {
          setFollowSystem(true);
          setTheme(selectedThemeName);
        }
      }}
      aria-label={`Theme: ${label}. Click to switch.`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
