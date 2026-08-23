"use client";

import { HardDrive, KeyRound, Palette, Shield, User } from "lucide-react";
import { useQueryState } from "nuqs";
import { AppearanceTab, SettingsDialog as SettingsDialogShell, StorageTab } from "@openinary/ui";
import { AccountTab } from "./account-tab";
import { SecurityTab } from "./security-tab";
import { ApiKeysTab } from "./api-keys-tab";

interface SettingsDialogProps {
  userName: string;
  userEmail: string;
  userAvatar: string;
}

const SETTINGS_NAV = [
  { value: "account", label: "Account", icon: User },
  { value: "security", label: "Security", icon: Shield },
  { value: "appearance", label: "Appearance", icon: Palette },
  { value: "api-keys", label: "API Keys", icon: KeyRound },
  { value: "storage", label: "Storage", icon: HardDrive },
];

export function SettingsDialog({
  userName,
  userEmail,
  userAvatar,
}: SettingsDialogProps) {
  const [tab, setTab] = useQueryState("settings");

  const dialogOpen = tab !== null;
  const activeTab = tab || "account";

  return (
    <SettingsDialogShell
      open={dialogOpen}
      onOpenChange={(open) => !open && setTab(null)}
      nav={SETTINGS_NAV}
      tab={activeTab}
      onTabChange={setTab}
    >
      {activeTab === "account" && (
        <AccountTab
          userName={userName}
          userEmail={userEmail}
          userAvatar={userAvatar}
          isOpen={dialogOpen && activeTab === "account"}
        />
      )}
      {activeTab === "security" && (
        <SecurityTab isOpen={dialogOpen && activeTab === "security"} />
      )}
      {activeTab === "appearance" && <AppearanceTab />}
      {activeTab === "api-keys" && <ApiKeysTab />}
      {activeTab === "storage" && <StorageTab />}
    </SettingsDialogShell>
  );
}
