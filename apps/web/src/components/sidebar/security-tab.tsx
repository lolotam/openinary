"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  QrCode,
  Copy,
  Download,
  Check,
  Loader2,
  Key,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import QRCode from "qrcode";
import logger from "@/lib/logger";

interface SecurityTabProps {
  isOpen?: boolean;
}

export function SecurityTab({ isOpen }: SecurityTabProps) {
  const { data: sessionData, refetch } = useSession();
  const [optimistic2FA, setOptimistic2FA] = useState<boolean | null>(null);
  const is2FAEnabled = optimistic2FA !== null ? optimistic2FA : Boolean(sessionData?.user?.twoFactorEnabled);

  // Enrollment Dialog state
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<"password" | "qr" | "backup-codes">("password");
  const [enrollPassword, setEnrollPassword] = useState("");
  const [enrollError, setEnrollError] = useState("");
  const [isStartingEnroll, setIsStartingEnroll] = useState(false);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [generatedBackupCodes, setGeneratedBackupCodes] = useState<string[]>([]);
  const [secretCopied, setSecretCopied] = useState(false);
  const [uriCopied, setUriCopied] = useState(false);
  const [backupCodesCopied, setBackupCodesCopied] = useState(false);

  // Disable 2FA Dialog state
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState("");
  const [isDisabling, setIsDisabling] = useState(false);

  // Regenerate Backup Codes Dialog state
  const [backupCodesDialogOpen, setBackupCodesDialogOpen] = useState(false);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupCodesStep, setBackupCodesStep] = useState<"password" | "display">("password");
  const [freshBackupCodes, setFreshBackupCodes] = useState<string[]>([]);
  const [backupError, setBackupError] = useState("");
  const [isRegeneratingBackupCodes, setIsRegeneratingBackupCodes] = useState(false);

  // Helper to extract TOTP secret from otpauth URI
  const extractSecret = (uri: string): string | null => {
    try {
      const url = new URL(uri);
      return url.searchParams.get("secret");
    } catch {
      const match = uri.match(/[?&]secret=([^&]+)/i);
      return match ? match[1] : null;
    }
  };

  const resetSetupState = () => {
    setSetupStep("password");
    setEnrollPassword("");
    setEnrollError("");
    setTotpUri(null);
    setTotpSecret(null);
    setQrCodeDataUrl(null);
    setVerifyCode("");
    setGeneratedBackupCodes([]);
    setSecretCopied(false);
    setUriCopied(false);
    setBackupCodesCopied(false);
  };

  const resetBackupCodesState = () => {
    setBackupCodesStep("password");
    setBackupPassword("");
    setBackupError("");
    setFreshBackupCodes([]);
    setBackupCodesCopied(false);
  };

  const handleStartSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollError("");

    if (!enrollPassword) {
      setEnrollError("Please enter your current password");
      return;
    }

    setIsStartingEnroll(true);
    try {
      const result = await authClient.twoFactor.enable({
        password: enrollPassword,
      });

      if (result?.error) {
        throw new Error(result.error.message || "Failed to start 2FA setup");
      }

      const uri = result?.data?.totpURI;
      const codes = result?.data?.backupCodes || [];

      if (!uri) {
        throw new Error("No TOTP configuration returned from server");
      }

      setTotpUri(uri);
      const secret = extractSecret(uri);
      setTotpSecret(secret);
      if (codes.length > 0) {
        setGeneratedBackupCodes(codes);
      }

      // Generate High-Res QR code for mobile scanning
      const qrUrl = await QRCode.toDataURL(uri, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: "M",
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      setQrCodeDataUrl(qrUrl);
      setSetupStep("qr");
    } catch (err) {
      logger.error("Error starting 2FA setup", { error: err });
      setEnrollError(err instanceof Error ? err.message : "Unable to initiate 2FA. Please check your password.");
    } finally {
      setIsStartingEnroll(false);
    }
  };

  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollError("");

    const cleanCode = verifyCode.trim().replace(/\D/g, "");
    if (cleanCode.length !== 6) {
      setEnrollError("Please enter a valid 6-digit verification code");
      return;
    }

    setIsVerifyingCode(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: cleanCode,
      });

      if (result?.error) {
        throw new Error(result.error.message || "Invalid verification code");
      }

      toast.success("Two-Factor Authentication enabled successfully!");

      // Optimistically flip the local 2FA state so UI updates immediately and avoids redundant enable calls
      setOptimistic2FA(true);

      // Clear sensitive password state
      setEnrollPassword("");

      // Transition immediately to backup codes reveal if available
      if (generatedBackupCodes.length > 0) {
        setSetupStep("backup-codes");
      } else {
        setSetupDialogOpen(false);
        resetSetupState();
      }

      // Trigger session refresh in background
      if (refetch) {
        refetch().catch(() => {
          logger.warn("2FA enabled, but background session refresh was delayed.");
        });
      }
    } catch (err) {
      logger.error("Error verifying TOTP code", { error: err });
      setEnrollError(err instanceof Error ? err.message : "Invalid code. Please check your authenticator app and try again.");
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableError("");

    if (!disablePassword) {
      setDisableError("Please enter your current password");
      return;
    }

    setIsDisabling(true);
    try {
      const result = await authClient.twoFactor.disable({
        password: disablePassword,
      });

      if (result?.error) {
        throw new Error(result.error.message || "Failed to disable 2FA");
      }

      toast.success("Two-Factor Authentication disabled");
      setOptimistic2FA(false);
      setDisableDialogOpen(false);
      setDisablePassword("");

      if (refetch) {
        refetch().catch(() => {
          logger.warn("2FA disabled, but background session refresh was delayed.");
        });
      }
    } catch (err) {
      logger.error("Error disabling 2FA", { error: err });
      setDisableError(err instanceof Error ? err.message : "Failed to disable 2FA. Please verify your password.");
    } finally {
      setIsDisabling(false);
    }
  };

  const handleRegenerateBackupCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setBackupError("");

    if (!backupPassword) {
      setBackupError("Please enter your current password");
      return;
    }

    setIsRegeneratingBackupCodes(true);
    try {
      const result = await authClient.twoFactor.generateBackupCodes({
        password: backupPassword,
      });

      if (result?.error) {
        throw new Error(result.error.message || "Failed to generate backup codes");
      }

      const codes = result?.data?.backupCodes || [];
      if (codes.length === 0) {
        throw new Error("No backup codes returned");
      }

      setFreshBackupCodes(codes);
      setBackupCodesStep("display");
      setBackupPassword("");
      toast.success("New backup codes generated!");
    } catch (err) {
      logger.error("Error regenerating backup codes", { error: err });
      setBackupError(err instanceof Error ? err.message : "Failed to generate new backup codes. Please check your password.");
    } finally {
      setIsRegeneratingBackupCodes(false);
    }
  };

  const handleCopyText = async (text: string, type: "secret" | "uri" | "backup") => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "secret") {
        setSecretCopied(true);
        setTimeout(() => setSecretCopied(false), 2000);
        toast.success("Secret key copied to clipboard");
      } else if (type === "uri") {
        setUriCopied(true);
        setTimeout(() => setUriCopied(false), 2000);
        toast.success("Setup URI copied to clipboard");
      } else if (type === "backup") {
        setBackupCodesCopied(true);
        setTimeout(() => setBackupCodesCopied(false), 2000);
        toast.success("Backup codes copied to clipboard");
      }
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleDownloadQrImage = () => {
    if (!qrCodeDataUrl) return;
    try {
      const link = document.createElement("a");
      link.href = qrCodeDataUrl;
      link.download = `openinary-2fa-qr-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("QR code image downloaded");
    } catch {
      toast.error("Failed to download QR code image");
    }
  };

  const handleDownloadBackupCodes = (codes: string[]) => {
    let url = "";
    try {
      const content = [
        "Openinary - Two-Factor Authentication Backup Codes",
        "Generated: " + new Date().toLocaleString(),
        "Account: " + (sessionData?.user?.email || "admin"),
        "",
        "Keep these codes safe and secure. Each code can only be used once to sign in if you lose access to your authenticator app.",
        "",
        ...codes.map((code, index) => `${index + 1}. ${code}`),
      ].join("\n");

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `openinary-backup-codes-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success("Backup codes downloaded");
    } catch {
      toast.error("Failed to download backup codes");
    } finally {
      if (url) {
        URL.revokeObjectURL(url);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* 2FA Status Card */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className={`mt-0.5 flex size-10 items-center justify-center rounded-lg ${
              is2FAEnabled ? "bg-emerald-500/10 text-emerald-500" : "bg-primary/10 text-primary"
            }`}>
              {is2FAEnabled ? (
                <ShieldCheck className="size-5" />
              ) : (
                <Shield className="size-5" />
              )}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base">Two-Factor Authentication</h3>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  is2FAEnabled
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {is2FAEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground max-w-md">
                {is2FAEnabled
                  ? "Your account is protected with two-factor authentication. A verification code from your authenticator app is required when signing in."
                  : "Protect your account from unauthorized access by requiring a verification code from your phone or authenticator app in addition to your password."}
              </p>
            </div>
          </div>

          <div>
            {is2FAEnabled ? (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                onClick={() => {
                  setDisablePassword("");
                  setDisableError("");
                  setDisableDialogOpen(true);
                }}
              >
                <ShieldOff className="size-4 mr-1.5" />
                Disable 2FA
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  resetSetupState();
                  setSetupDialogOpen(true);
                }}
              >
                <QrCode className="size-4 mr-1.5" />
                Set up 2FA
              </Button>
            )}
          </div>
        </div>

        {/* Active 2FA Details & Backup Codes Card */}
        {is2FAEnabled && (
          <div className="mt-5 pt-4 border-t space-y-3">
            <div className="flex items-center justify-between p-3 rounded-md bg-muted/40 text-sm">
              <div className="flex items-center gap-3">
                <Smartphone className="size-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">Authenticator App (TOTP)</p>
                  <p className="text-xs text-muted-foreground">
                    Google Authenticator, Authy, 1Password, Apple Passwords
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <Check className="size-3.5" />
                Active
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-md bg-muted/40 text-sm">
              <div className="flex items-center gap-3">
                <Key className="size-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">Backup Recovery Codes</p>
                  <p className="text-xs text-muted-foreground">
                    Use single-use emergency codes if you lose access to your authenticator device
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  resetBackupCodesState();
                  setBackupCodesDialogOpen(true);
                }}
              >
                <RefreshCw className="size-3.5 mr-1.5" />
                Generate New Codes
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Setup 2FA Dialog */}
      <Dialog
        open={setupDialogOpen}
        onOpenChange={(open) => {
          // If on the backup codes step, do not allow accidental dismissal via outside click
          if (!open && setupStep === "backup-codes") {
            return;
          }
          if (!open) resetSetupState();
          setSetupDialogOpen(open);
        }}
      >
        <DialogContent
          className="max-w-md"
          onInteractOutside={(e) => {
            if (setupStep === "backup-codes") e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (setupStep === "backup-codes") e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Set up Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              {setupStep === "password" && "Confirm your password to begin setting up two-factor authentication."}
              {setupStep === "qr" && "Scan the QR code with your authenticator app, then enter the 6-digit code."}
              {setupStep === "backup-codes" && "Save your backup recovery codes in a secure location."}
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Password Confirmation */}
          {setupStep === "password" && (
            <form onSubmit={handleStartSetup} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="enroll-password">Current Password</Label>
                <Input
                  id="enroll-password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={enrollPassword}
                  onChange={(e) => setEnrollPassword(e.target.value)}
                  autoFocus
                />
              </div>

              {enrollError && (
                <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>{enrollError}</span>
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSetupDialogOpen(false)}
                  disabled={isStartingEnroll}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isStartingEnroll || !enrollPassword}>
                  {isStartingEnroll ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}

          {/* Step 2: QR Code & Verification */}
          {setupStep === "qr" && (
            <div className="space-y-5 pt-1">
              {qrCodeDataUrl && (
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 bg-white rounded-xl shadow-sm border">
                    <img
                      src={qrCodeDataUrl}
                      alt="2FA QR Code"
                      className="size-48 rounded"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {totpUri && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => handleCopyText(totpUri, "uri")}
                      >
                        {uriCopied ? (
                          <>
                            <Check className="size-3.5 mr-1 text-emerald-500" />
                            URI Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5 mr-1" />
                            Copy Setup URI
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={handleDownloadQrImage}
                    >
                      <Download className="size-3.5 mr-1" />
                      Download QR
                    </Button>
                  </div>
                </div>
              )}

              {totpSecret && (
                <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-center">
                  <span className="text-xs text-muted-foreground block">
                    Can't scan? Enter this secret manually:
                  </span>
                  <div className="flex items-center justify-center gap-2">
                    <code className="text-xs font-mono font-semibold tracking-wider select-all bg-background px-2 py-1 rounded border">
                      {totpSecret}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleCopyText(totpSecret, "secret")}
                    >
                      {secretCopied ? (
                        <Check className="size-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <form onSubmit={handleVerifyTotp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="verify-code">6-Digit Verification Code</Label>
                  <Input
                    id="verify-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={verifyCode}
                    maxLength={6}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="text-center text-lg font-mono tracking-widest"
                    autoFocus
                  />
                </div>

                {enrollError && (
                  <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>{enrollError}</span>
                  </div>
                )}

                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSetupDialogOpen(false);
                      resetSetupState();
                    }}
                    disabled={isVerifyingCode}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isVerifyingCode || verifyCode.trim().length !== 6}
                  >
                    {isVerifyingCode ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Verify & Enable"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </div>
          )}

          {/* Step 3: Reveal Generated Backup Codes */}
          {setupStep === "backup-codes" && (
            <div className="space-y-5 pt-1">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="size-4 shrink-0" />
                  Save these backup codes now!
                </p>
                <p>
                  These codes will only be shown once. If you lose your authenticator app, you can use these codes to regain access to your account.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40 rounded-lg border">
                {generatedBackupCodes.map((code, index) => (
                  <div
                    key={index}
                    className="font-mono text-xs text-center py-1.5 px-2 bg-background rounded border tracking-wider font-semibold select-all"
                  >
                    {code}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleCopyText(generatedBackupCodes.join("\n"), "backup")}
                >
                  {backupCodesCopied ? (
                    <>
                      <Check className="size-4 mr-1.5 text-emerald-500" />
                      Codes Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-4 mr-1.5" />
                      Copy All Codes
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleDownloadBackupCodes(generatedBackupCodes)}
                >
                  <Download className="size-4 mr-1.5" />
                  Download .txt
                </Button>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    setSetupDialogOpen(false);
                    resetSetupState();
                  }}
                >
                  I have saved my backup codes
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Disable 2FA Dialog */}
      <Dialog open={disableDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setDisablePassword("");
          setDisableError("");
        }
        setDisableDialogOpen(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <ShieldOff className="size-5" />
              Disable Two-Factor Authentication
            </DialogTitle>
            <DialogDescription>
              Disabling two-factor authentication will reduce your account security. Please enter your password to confirm.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleDisable2FA} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="disable-password">Confirm Password</Label>
              <Input
                id="disable-password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                autoFocus
              />
            </div>

            {disableError && (
              <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{disableError}</span>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDisableDialogOpen(false)}
                disabled={isDisabling}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isDisabling || !disablePassword}
              >
                {isDisabling ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Disabling...
                  </>
                ) : (
                  "Disable 2FA"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Regenerate Backup Codes Dialog */}
      <Dialog open={backupCodesDialogOpen} onOpenChange={(open) => {
        if (!open) resetBackupCodesState();
        setBackupCodesDialogOpen(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate New Backup Codes</DialogTitle>
            <DialogDescription>
              {backupCodesStep === "password"
                ? "Enter your password to generate a fresh set of single-use backup recovery codes. Any previous codes will be invalidated."
                : "Your new backup recovery codes have been generated. Save them in a secure place."}
            </DialogDescription>
          </DialogHeader>

          {backupCodesStep === "password" ? (
            <form onSubmit={handleRegenerateBackupCodes} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="backup-password">Current Password</Label>
                <Input
                  id="backup-password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={backupPassword}
                  onChange={(e) => setBackupPassword(e.target.value)}
                  autoFocus
                />
              </div>

              {backupError && (
                <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>{backupError}</span>
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBackupCodesDialogOpen(false)}
                  disabled={isRegeneratingBackupCodes}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isRegeneratingBackupCodes || !backupPassword}
                >
                  {isRegeneratingBackupCodes ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    "Generate Codes"
                  )}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-5 pt-1">
              <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40 rounded-lg border">
                {freshBackupCodes.map((code, index) => (
                  <div
                    key={index}
                    className="font-mono text-xs text-center py-1.5 px-2 bg-background rounded border tracking-wider font-semibold select-all"
                  >
                    {code}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleCopyText(freshBackupCodes.join("\n"), "backup")}
                >
                  {backupCodesCopied ? (
                    <>
                      <Check className="size-4 mr-1.5 text-emerald-500" />
                      Codes Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-4 mr-1.5" />
                      Copy All Codes
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleDownloadBackupCodes(freshBackupCodes)}
                >
                  <Download className="size-4 mr-1.5" />
                  Download .txt
                </Button>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    setBackupCodesDialogOpen(false);
                    resetBackupCodesState();
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
