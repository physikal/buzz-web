import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "buzz-web-sidebar-open.v1";

type SidebarVisibility = {
  open: boolean;
  toggle: () => void;
};

const SidebarVisibilityContext = createContext<SidebarVisibility | null>(null);

function readInitialState() {
  return window.localStorage.getItem(STORAGE_KEY) !== "false";
}

export function SidebarVisibilityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(readInitialState);
  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);
  const value = useMemo(() => ({ open, toggle }), [open, toggle]);
  return (
    <SidebarVisibilityContext.Provider value={value}>
      {children}
    </SidebarVisibilityContext.Provider>
  );
}

export function useSidebarVisibility() {
  const value = useContext(SidebarVisibilityContext);
  if (!value)
    throw new Error(
      "useSidebarVisibility must be used within SidebarVisibilityProvider",
    );
  return value;
}
