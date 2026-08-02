import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { useSidebarVisibility } from "@/shared/hooks/use-sidebar-visibility";
import { Button } from "./button";

export function SidebarToggleButton() {
  const sidebar = useSidebarVisibility();
  return (
    <Button
      aria-label="Toggle Sidebar"
      className="hidden sm:inline-flex"
      onClick={sidebar.toggle}
      size="icon"
      title="Toggle Sidebar"
      variant="ghost"
    >
      {sidebar.open ? <PanelLeftClose /> : <PanelLeftOpen />}
    </Button>
  );
}
