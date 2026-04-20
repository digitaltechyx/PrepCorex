"use client";

import { LogOut, User as UserIcon, CheckCircle, Bell, CheckCheck, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { hasRole, isAccountActivated, hasFeature } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCollection } from "@/hooks/use-collection";
import { doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useMemo } from "react";

type UserNotification = {
  id: string;
  title?: string;
  message?: string;
  type?: string;
  isRead?: boolean;
  createdAt?: any;
  targetUrl?: string;
};

interface DashboardHeaderProps {
  onProfileClick?: () => void;
}

export function DashboardHeader({ onProfileClick }: DashboardHeaderProps) {
  const { signOut, userProfile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { data: notifications } = useCollection<UserNotification>(
    userProfile?.uid ? `users/${userProfile.uid}/notifications` : ""
  );

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const handleProfileClick = () => {
    if (onProfileClick) {
      onProfileClick();
    } else {
      window.dispatchEvent(new Event("toggle-profile"));
    }
  };

  const getInitials = (name?: string | null) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  const getAvatarSrc = () => {
    if (userProfile?.profilePictureUrl) {
      return userProfile.profilePictureUrl;
    }
    if (userProfile?.email) {
      return `https://avatar.vercel.sh/${encodeURIComponent(userProfile.email)}.png`;
    }
    return undefined;
  };

  const sortedNotifications = useMemo(() => {
    return [...notifications].sort((a, b) => {
      const toMs = (value: any) => {
        if (!value) return 0;
        if (typeof value === "string") return new Date(value).getTime() || 0;
        if (value && typeof value === "object" && "seconds" in value) return Number(value.seconds) * 1000;
        return 0;
      };
      return toMs(b.createdAt) - toMs(a.createdAt);
    });
  }, [notifications]);

  const unreadCount = useMemo(
    () => sortedNotifications.filter((item) => !item.isRead).length,
    [sortedNotifications]
  );

  const markAsRead = async (notificationId: string) => {
    if (!userProfile?.uid) return;
    try {
      await updateDoc(doc(db, `users/${userProfile.uid}/notifications`, notificationId), {
        isRead: true,
      });
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const markAllAsRead = async () => {
    if (!userProfile?.uid) return;
    const unreadNotifications = sortedNotifications.filter((item) => !item.isRead);
    if (unreadNotifications.length === 0) return;
    try {
      const batch = writeBatch(db);
      unreadNotifications.forEach((item) => {
        const ref = doc(db, `users/${userProfile.uid}/notifications`, item.id);
        batch.update(ref, { isRead: true });
      });
      await batch.commit();
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error);
    }
  };

  const isAffiliateZone =
    pathname === "/dashboard/agent" || pathname?.startsWith("/dashboard/agent/");
  const hasAgentRole = hasRole(userProfile, "commission_agent");
  const hasUserRole = hasRole(userProfile, "user");
  const hasAdminRole = hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin");
  const affiliateShell =
    isAffiliateZone &&
    hasAgentRole &&
    hasFeature(userProfile, "affiliate_dashboard");
  const affiliateBackHref = hasUserRole ? "/dashboard" : hasAdminRole ? "/admin/dashboard" : "/dashboard";
  const affiliateBackLabel = hasUserRole ? "Client dashboard" : hasAdminRole ? "Admin dashboard" : "Dashboard";

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border/40 bg-white px-3 sm:gap-4 sm:px-4 lg:px-6">
      <SidebarTrigger className="-ml-1 shrink-0" />

      {affiliateShell && (
        <Link
          href={affiliateBackHref}
          className="group flex min-w-0 max-w-[min(100%,14rem)] shrink items-center gap-1 rounded-md border border-transparent px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground sm:max-w-xs"
        >
          <ChevronLeft className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />
          <span className="truncate font-medium">{affiliateBackLabel}</span>
        </Link>
      )}

      <div className="flex flex-1 items-center justify-between gap-2 overflow-hidden sm:justify-end sm:gap-4">
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full sm:h-10 sm:w-10">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
                <span className="sr-only">Notifications</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[340px]" align="end">
              <DropdownMenuLabel className="flex items-center justify-between gap-2">
                <span>Notifications</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={markAllAsRead}
                  disabled={unreadCount === 0}
                >
                  <CheckCheck className="mr-1 h-3.5 w-3.5" />
                  Mark all read
                </Button>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-[320px] overflow-y-auto">
                {sortedNotifications.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No notifications yet.
                  </div>
                ) : (
                  sortedNotifications.slice(0, 20).map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      className="block cursor-pointer whitespace-normal p-3"
                      onClick={() => {
                        if (!item.isRead) {
                          markAsRead(item.id);
                        }
                        if (item.targetUrl) {
                          router.push(item.targetUrl);
                        }
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {!item.isRead ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" /> : <span className="mt-1 h-2 w-2 shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-5">{item.title || "Notification"}</p>
                          <p className="text-xs text-muted-foreground leading-5">{item.message || ""}</p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="hidden flex-col items-end sm:flex">
            <span className="text-sm font-medium">{userProfile?.name}</span>
            <span className="text-xs text-muted-foreground">
              User{userProfile?.clientId ? ` · #${userProfile.clientId}` : ""}
              {hasRole(userProfile, "user") && isAccountActivated(userProfile) && (
                <Badge variant="outline" className="ml-2 border-green-500/50 bg-green-50 text-green-700 text-[10px] px-1.5 py-0">
                  <CheckCircle className="h-3 w-3 mr-0.5" />
                  Active
                </Badge>
              )}
            </span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full sm:h-10 sm:w-10">
                <Avatar className="h-9 w-9 border-2 border-border sm:h-10 sm:w-10">
                  <AvatarImage
                    src={getAvatarSrc()}
                    alt={userProfile?.name || "User"}
                  />
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-semibold text-white">
                    {getInitials(userProfile?.name)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{userProfile?.name}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {userProfile?.email}
                  </p>
                  {userProfile?.clientId && (
                    <p className="text-xs leading-none text-muted-foreground pt-0.5">
                      Client ID: <span className="font-medium text-foreground">#{userProfile.clientId}</span>
                    </p>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleProfileClick} className="cursor-pointer">
                <UserIcon className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="cursor-pointer text-red-600 focus:text-red-600"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
