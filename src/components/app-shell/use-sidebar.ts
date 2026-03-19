import { useEffect, useMemo, useState } from "react";
import { createLogger } from "../../lib/logger";
import {
  type ShellRoute,
  type SidebarSectionId,
  type SidebarSectionCollapseState,
  getWorkspaceGroupCollapseKey,
  isDesktopShellViewport,
  loadSidebarSectionCollapseState,
  saveSidebarSectionCollapseState,
} from "./shell-types";

const log = createLogger("AppShell");

export interface UseSidebarResult {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  shellHeaderOffsetClassName: string;
  navigateWithinShell: (route: ShellRoute) => void;
  openSidebar: () => void;
  hideSidebar: () => void;
  isSectionCollapsed: (sectionId: SidebarSectionId) => boolean;
  toggleSectionCollapsed: (sectionId: SidebarSectionId) => void;
  toggleWorkspaceGroupCollapsed: (sectionId: SidebarSectionId, groupKey: string) => void;
  collapsedWorkspaceGroups: Partial<Record<string, boolean>>;
}

export function useSidebar(_route: ShellRoute, onNavigate: (route: ShellRoute) => void): UseSidebarResult {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const initialSidebarSectionState = useMemo(() => loadSidebarSectionCollapseState(), []);
  const [collapsedSections, setCollapsedSections] = useState<SidebarSectionCollapseState>(
    initialSidebarSectionState.state,
  );
  const [collapsedWorkspaceGroups, setCollapsedWorkspaceGroups] = useState<Partial<Record<string, boolean>>>({});

  const shellHeaderOffsetClassName = sidebarCollapsed
    ? "ml-14 sm:ml-16 lg:ml-[4.5rem]"
    : "ml-14 sm:ml-16 lg:ml-0";

  useEffect(() => {
    if (!initialSidebarSectionState.invalidReason) {
      return;
    }
    log.warn("Removing invalid sidebar section state", { error: initialSidebarSectionState.invalidReason });
  }, [initialSidebarSectionState.invalidReason]);

  useEffect(() => {
    saveSidebarSectionCollapseState(collapsedSections);
  }, [collapsedSections]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setSidebarOpen(false);
      }
    };

    if (mediaQuery.matches) {
      setSidebarOpen(false);
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const navigateWithinShell = (nextRoute: ShellRoute) => {
    setSidebarOpen(false);
    onNavigate(nextRoute);
  };

  const openSidebar = () => {
    if (isDesktopShellViewport()) {
      setSidebarCollapsed(false);
      return;
    }
    setSidebarOpen(true);
  };

  const hideSidebar = () => {
    if (isDesktopShellViewport()) {
      setSidebarCollapsed(true);
      return;
    }
    setSidebarOpen(false);
  };

  function isSectionCollapsed(sectionId: SidebarSectionId): boolean {
    return collapsedSections[sectionId] ?? false;
  }

  function toggleSectionCollapsed(sectionId: SidebarSectionId) {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !(current[sectionId] ?? false),
    }));
  }

  function toggleWorkspaceGroupCollapsed(sectionId: SidebarSectionId, groupKey: string) {
    const collapseKey = getWorkspaceGroupCollapseKey(sectionId, groupKey);
    setCollapsedWorkspaceGroups((current) => ({
      ...current,
      [collapseKey]: !(current[collapseKey] ?? false),
    }));
  }

// Suppress unused warning — route may be used in the future for route-aware sidebar behavior.
  return {
    sidebarOpen,
    sidebarCollapsed,
    shellHeaderOffsetClassName,
    navigateWithinShell,
    openSidebar,
    hideSidebar,
    isSectionCollapsed,
    toggleSectionCollapsed,
    toggleWorkspaceGroupCollapsed,
    collapsedWorkspaceGroups,
  };
}
