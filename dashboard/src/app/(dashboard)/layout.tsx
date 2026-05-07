import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { FiringBanner } from "@/components/monitors/firing-banner";
import { Toaster, ToastProvider } from "@/components/ui/toast";
import { getOrCreateOrg } from "@/lib/org";
import { getCurrentUser } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const org = await getOrCreateOrg();
  const userAvatarUrl =
    typeof user.user_metadata.avatar_url === "string"
      ? user.user_metadata.avatar_url
      : typeof user.user_metadata.picture === "string"
        ? user.user_metadata.picture
        : null;

  return (
    // ToastProvider lives at the (dashboard) layout root so every server
    // action consumer downstream can surface `{ ok: false }` envelopes via
    // `useToast()` without each page re-wiring it. Standard pattern per
    // `components/ui/toast.tsx` and `dashboard-conventions-drift.md` §2.8.
    <ToastProvider>
      <div className="flex min-h-screen bg-background">
        <Sidebar
          workspaceLabel={org?.name ?? "Workspace"}
          userEmail={user.email ?? "Signed in"}
          userAvatarUrl={userAvatarUrl}
        />
        <div className="min-w-0 flex-1 overflow-y-auto">
          {/*
           * Firing-monitor banner (F10 / task #21). Returns null when zero
           * monitors are firing — guarded by `org?.id` because the whole
           * monitor subsystem is org-scoped. Skipping the banner entirely
           * when the org isn't resolvable avoids fetching anything during
           * the `<TenantContextFallback />` paths that pages render.
           */}
          {org?.id ? <FiringBanner orgId={org.id} /> : null}
          {children}
        </div>
      </div>
      <Toaster />
    </ToastProvider>
  );
}
