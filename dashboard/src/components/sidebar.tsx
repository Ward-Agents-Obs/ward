"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { useState } from "react";
import {
  ChevronLeft,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  LibraryBig,
  List,
  Radar,
  Settings,
  SlidersHorizontal,
  Sparkles,
  TestTube2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { DASHBOARD_DOCS_URL } from "@/lib/dashboard-config";

interface SidebarProps {
  workspaceLabel: string;
  userEmail: string;
  userAvatarUrl: string | null;
  projectSlug?: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

function getInitials(email: string) {
  const [first = "A", second = ""] = email.split("@")[0]?.split(/[.\-_]/) ?? [];
  return `${first[0] ?? "A"}${second[0] ?? ""}`.toUpperCase();
}

function buildWorkspaceNav(): NavGroup[] {
  // V1 sidebar: only routes that exist. Settings is rendered in the footer below.
  // Project workbench (datasets/playground/etc.) and Wardbugger are deferred to V1.1+
  // and are exposed via `buildProjectNav()` behind the projects feature flag.
  return [
    {
      label: "Workspace",
      items: [
        { href: "/overview", label: "Overview", icon: LayoutDashboard },
        { href: "/traces", label: "Tracing", icon: List },
        { href: "/monitors", label: "Monitors", icon: Radar },
      ],
    },
  ];
}

/**
 * Feature flag for the project shell. V1 ships single-org without project sub-tenancy;
 * the `/projects/<slug>/*` routes stay in the codebase but are unlinked from the sidebar.
 * Set NEXT_PUBLIC_PROJECTS_ENABLED=true in the env to revive the project workbench nav.
 */
function isProjectsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PROJECTS_ENABLED === "true";
}

function buildProjectNav(projectSlug: string): NavGroup[] {
  const base = `/projects/${projectSlug}`;
  return [
    {
      label: "Observe",
      items: [
        { href: base, label: "Dashboard", icon: LayoutDashboard },
        { href: `${base}/traces`, label: "Tracing", icon: List },
        { href: `${base}/monitors`, label: "Monitors", icon: Radar },
      ],
    },
    {
      label: "Workbench",
      items: [
        { href: `${base}/datasets`, label: "Datasets", icon: FolderKanban },
        { href: `${base}/playground`, label: "Playgrounds", icon: Sparkles },
        { href: `${base}/experiments`, label: "Experiments", icon: FlaskConical },
        { href: `${base}/ab-tests`, label: "A/B Tests", icon: SlidersHorizontal },
        { href: `${base}/evals`, label: "Evaluators", icon: TestTube2 },
        { href: `${base}/prompts`, label: "Prompts", icon: LibraryBig },
      ],
    },
  ];
}

function resolveProjectSlug(pathname: string, projectSlug?: string): string | null {
  if (projectSlug) {
    return projectSlug;
  }

  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match?.[1] ?? null;
}

export function Sidebar({
  workspaceLabel,
  userEmail,
  userAvatarUrl,
  projectSlug,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  // V1: never render the project shell from the sidebar unless the projects flag is on.
  // The `/projects/<slug>` route still works if visited directly, but the workspace
  // nav stays visible so users always have a way back to Overview/Tracing/Monitors.
  const activeProjectSlug = isProjectsEnabled()
    ? resolveProjectSlug(pathname, projectSlug)
    : null;
  const navGroups = activeProjectSlug ? buildProjectNav(activeProjectSlug) : buildWorkspaceNav();
  const workspaceCompactLabel = workspaceLabel.slice(0, 2).toUpperCase() || "WS";
  const title = activeProjectSlug ? "Project Command Center" : "Workspace Command Center";

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col border-r tech-border bg-panel/95 backdrop-blur transition-[width] duration-200",
        collapsed ? "w-[5.5rem]" : "w-80"
      )}
    >
      <div className="border-b tech-border px-4 py-4">
        <div className={cn("group flex items-center", collapsed ? "justify-center" : "gap-3")}>
          <button
            type="button"
            onClick={() => collapsed && setCollapsed(false)}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm transition-colors",
              collapsed && "cursor-pointer hover:bg-foreground/90"
            )}
            aria-label={collapsed ? "Expand sidebar" : undefined}
          >
            <Logo className="h-6 w-6 text-background" />
          </button>
          {!collapsed ? (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Ward
                </p>
                <p className="truncate text-sm font-medium text-foreground">
                  {title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border tech-border bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-panel-hover hover:text-foreground group-hover:opacity-100"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          ) : null}
        </div>

        <div
          className={cn(
            "mt-4 rounded-2xl border tech-border bg-background/80 p-3 transition-all",
            collapsed && "px-2 py-3 text-center"
          )}
        >
          {!collapsed ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Workspace
            </p>
          ) : null}
          <p className={cn("truncate text-sm font-medium text-foreground", !collapsed && "mt-2", collapsed && "text-xs")}>
            {collapsed ? workspaceCompactLabel : workspaceLabel}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            {!collapsed ? (
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                {group.label}
              </p>
            ) : null}
            <div className={cn("space-y-1.5", !collapsed && "mt-3")}>
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center rounded-2xl px-3 py-3 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-foreground/25",
                      collapsed ? "justify-center" : "gap-3",
                      isActive
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:bg-background hover:text-foreground"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive ? "text-background" : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    {!collapsed ? <span>{item.label}</span> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t tech-border px-3 py-4">
        <div className="space-y-1.5">
          <Link
            href="/settings"
            className={cn(
              "flex items-center rounded-2xl px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
              collapsed ? "justify-center" : "gap-3"
            )}
            title={collapsed ? "Settings" : undefined}
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!collapsed ? <span>Settings</span> : null}
          </Link>
          <Link
            href={DASHBOARD_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center rounded-2xl px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
              collapsed ? "justify-center" : "gap-3"
            )}
            title={collapsed ? "Docs" : undefined}
          >
            <LibraryBig className="h-4 w-4 shrink-0" />
            {!collapsed ? <span>Docs</span> : null}
          </Link>
        </div>

        <div className="mt-4 rounded-2xl border tech-border bg-background/80 p-3">
          <div className={cn("relative flex items-center", collapsed ? "justify-center" : "gap-3")}>
            <button type="button" onClick={() => setShowLogout(!showLogout)} className="shrink-0 rounded-2xl outline-none transition-opacity hover:opacity-80">
              {userAvatarUrl ? (
                <div
                  aria-hidden="true"
                  className="h-10 w-10 rounded-2xl bg-cover bg-center"
                  style={{ backgroundImage: `url(${userAvatarUrl})` }}
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-foreground/10 text-xs font-semibold text-foreground">
                  {getInitials(userEmail)}
                </div>
              )}
            </button>

            {!collapsed ? (
              <div className="min-w-0 flex-1">
                {showLogout ? (
                  <form action="/auth/sign-out" method="post">
                    <button
                      type="submit"
                      className="truncate text-sm font-medium text-destructive transition-colors hover:underline"
                    >
                      Log out
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowLogout(true)}
                    className="truncate text-sm font-medium text-foreground transition-colors hover:text-muted-foreground"
                  >
                    Profile
                  </button>
                )}
              </div>
            ) : (
              collapsed && showLogout ? (
                <form action="/auth/sign-out" method="post" className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/90 backdrop-blur">
                  <button type="submit" className="text-xs font-bold text-destructive hover:underline">Out</button>
                </form>
              ) : null
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
