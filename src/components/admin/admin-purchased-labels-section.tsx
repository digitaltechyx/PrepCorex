"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Package } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { PurchasedLabelsPanel } from "@/components/labels/purchased-labels-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { hasRole } from "@/lib/permissions";

type ViewMode = "mine" | "client";

export function AdminPurchasedLabelsSection() {
  const { userProfile } = useAuth();
  const { managedUsers, loading: usersLoading } = useManagedUsers();
  const [viewMode, setViewMode] = useState<ViewMode>("mine");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userPickerOpen, setUserPickerOpen] = useState(false);

  const approvedUsers = useMemo(
    () =>
      managedUsers
        .filter((u) => u.uid && u.status !== "deleted" && hasRole(u, "user"))
        .sort((a, b) =>
          formatUserDisplayName(a, { showEmail: false }).localeCompare(
            formatUserDisplayName(b, { showEmail: false })
          )
        ),
    [managedUsers]
  );

  const selectedUser = approvedUsers.find((u) => u.uid === selectedUserId) || null;
  const activeUserId = viewMode === "mine" ? userProfile?.uid : selectedUser?.uid;

  return (
    <div className="space-y-6">
      <Card className="border border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Whose labels?</CardTitle>
          <CardDescription>
            Labels you buy here are saved under your admin account. You can also open any
            client&apos;s purchase history.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="mine">My purchases</TabsTrigger>
              <TabsTrigger value="client">Client purchases</TabsTrigger>
            </TabsList>
          </Tabs>

          {viewMode === "client" && (
            <Popover open={userPickerOpen} onOpenChange={setUserPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={userPickerOpen}
                  className="w-full justify-between sm:max-w-md"
                  disabled={usersLoading}
                >
                  {selectedUser
                    ? formatUserDisplayName(selectedUser, { showEmail: true })
                    : "Select client…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(100vw-2rem,28rem)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search clients…" />
                  <CommandList>
                    <CommandEmpty>No client found.</CommandEmpty>
                    <CommandGroup>
                      {approvedUsers.map((user) => (
                        <CommandItem
                          key={user.uid}
                          value={`${formatUserDisplayName(user, { showEmail: true })} ${user.uid}`}
                          onSelect={() => {
                            setSelectedUserId(user.uid);
                            setUserPickerOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedUserId === user.uid ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {formatUserDisplayName(user, { showEmail: false })}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </CardContent>
      </Card>

      <PurchasedLabelsPanel
        userId={activeUserId}
        emptyHint={
          viewMode === "mine"
            ? "Buy a label from the Buy Label tab — completed purchases will appear here for download."
            : selectedUser
              ? "This client has not purchased any labels yet."
              : "Select a client to view their purchased labels."
        }
      />

      {viewMode === "client" && !selectedUser && !usersLoading && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Package className="h-4 w-4" />
          Pick a client above to load their label history.
        </div>
      )}
    </div>
  );
}
