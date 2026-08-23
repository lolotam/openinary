"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import logger from "@/lib/logger";
import { validateAuthConfig } from "@/lib/validate-auth-config";
import { VersionBadge } from "@/components/ui/version-badge";
import { ArrowLeft, KeyRound, Loader2, Shield } from "lucide-react";

const loginFormSchema = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Please enter a valid email address"),
  password: z.string().min(1, {
    message: "Password is required",
  }),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // 2FA Challenge state
  const [isTwoFactorView, setIsTwoFactorView] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [isVerifyingTwoFactor, setIsVerifyingTwoFactor] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // Check if user is already authenticated and if setup is required on mount
  useEffect(() => {
    let isMounted = true;

    const checkAuthAndSetup = async () => {
      try {
        // First, validate authentication configuration
        const configValidation = await validateAuthConfig();
        
        if (!isMounted) return;
        
        if (!configValidation.isValid) {
          // Show configuration error and block access
          setConfigError(configValidation.error || "Configuration error");
          setCheckingSetup(false);
          return;
        }
        
        // Next, check if user is already authenticated
        // Add timeout to prevent infinite loading
        const sessionPromise = authClient.getSession();
        // Promise<never>: it only ever rejects, so the race keeps the session's
        // own type instead of widening to unknown.
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Session check timeout")), 3000)
        );

        const session = await Promise.race([sessionPromise, timeoutPromise]);
        
        if (!isMounted) return;
        
        if (session?.data?.session) {
          // User is already signed in, redirect to home
          router.push("/");
          return;
        }

        // If not authenticated, check if setup is required
        const response = await fetch("/api/check-setup", {
          signal: AbortSignal.timeout(3000), // 3 second timeout
        });
        const data = await response.json();
        
        if (!isMounted) return;
        
        if (!data.setupComplete) {
          router.push("/setup");
        } else {
          setCheckingSetup(false);
        }
      } catch (err) {
        logger.error("Error checking auth/setup", { error: err });
        if (!isMounted) return;
        
        // On error, still check setup status to avoid being stuck
        try {
          const response = await fetch("/api/check-setup", {
            signal: AbortSignal.timeout(3000),
          });
          const data = await response.json();
          if (!isMounted) return;
          
          if (!data.setupComplete) {
            router.push("/setup");
          } else {
            setCheckingSetup(false);
          }
        } catch (setupErr) {
          logger.error("Error checking setup", { error: setupErr });
          // Always unblock the UI after timeout/error to prevent infinite loading
          if (isMounted) {
            setCheckingSetup(false);
          }
        }
      }
    };

    // Add a fallback timeout to ensure we never stay stuck
    const timeoutId = setTimeout(() => {
      if (isMounted) {
        logger.warn("Auth check timeout - unblocking UI");
        setCheckingSetup(false);
      }
    }, 5000); // 5 second absolute timeout

    checkAuthAndSetup().finally(() => {
      if (isMounted) {
        clearTimeout(timeoutId);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [router]);

  const onSubmit = async (values: LoginFormValues) => {
    setError("");

    try {
      const result = await authClient.signIn.email({
        email: values.email,
        password: values.password,
      });

      // Check if 2FA verification is required
      if (result?.data && "twoFactorRedirect" in result.data && Boolean(result.data.twoFactorRedirect)) {
        setIsTwoFactorView(true);
        setTwoFactorCode("");
        return;
      }

      // Verify the sign-in was successful
      if (result && result.data) {
        // Wait a bit for cookie to be set, then redirect
        // This ensures the cookie is available when middleware checks
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Use window.location for a full page reload to ensure cookies are synced
        // This prevents issues with cookie synchronization after login
        window.location.href = "/";
      } else {
        logger.error("[Login] Sign in failed - no data in result", { result });
        throw new Error(result?.error?.message || "Sign in failed - please try again");
      }
    } catch (err) {
      logger.error("[Login] Sign in error", { error: err });
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Incorrect email or password",
      );
    }
  };

  const handleTwoFactorVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const rawCode = twoFactorCode.trim();
    if (!rawCode) {
      setError("Please enter your verification or backup recovery code");
      return;
    }

    // Strip spaces / non-digits to support codes formatted like "123 456"
    const digitsOnly = rawCode.replace(/\D/g, "");
    const is6DigitCode = digitsOnly.length === 6;
    const isBackupCode = rawCode.length >= 6;

    setIsVerifyingTwoFactor(true);
    try {
      let result;
      if (is6DigitCode) {
        // Verify via TOTP Authenticator code
        result = await authClient.twoFactor.verifyTotp({
          code: digitsOnly,
        });
      } else if (isBackupCode) {
        // Verify via Backup recovery code
        result = await authClient.twoFactor.verifyBackupCode({
          code: rawCode,
        });
      } else {
        throw new Error("Enter a valid 6-digit authenticator code or backup recovery code");
      }

      if (result?.error) {
        throw new Error(result.error.message || "Invalid verification code");
      }

      // Wait a bit for cookies to sync, then redirect
      await new Promise(resolve => setTimeout(resolve, 200));
      window.location.href = "/";
    } catch (err) {
      logger.error("[Login] 2FA verification error", { error: err });
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Invalid code. Please try again.",
      );
    } finally {
      setIsVerifyingTwoFactor(false);
    }
  };

  if (checkingSetup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <Spinner className="mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <VersionBadge />
      <div className="w-full max-w-md space-y-8">
        <div className="flex justify-center">
          <Image
            src="/openinary.svg"
            alt="Openinary"
            width={120}
            height={120}
            className="dark:invert"
          />
        </div>

        {isTwoFactorView ? (
          // Two-Factor Authentication Challenge Screen
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Shield className="size-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                Two-Factor Authentication
              </h1>
              <p className="text-sm text-muted-foreground">
                Enter the 6-digit code from your authenticator app or a single-use backup recovery code.
              </p>
            </div>

            <form onSubmit={handleTwoFactorVerify} className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="twoFactorCode">Verification Code</Label>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <KeyRound className="size-3" />
                    TOTP or Backup Code
                  </span>
                </div>
                <Input
                  id="twoFactorCode"
                  type="text"
                  placeholder="123456"
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  className="text-center text-lg font-mono tracking-widest"
                  autoFocus
                />
              </div>

              {error && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={isVerifyingTwoFactor || !twoFactorCode.trim()}
                className="w-full"
              >
                {isVerifyingTwoFactor ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify & Continue"
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full text-xs text-muted-foreground"
                onClick={() => {
                  setIsTwoFactorView(false);
                  setTwoFactorCode("");
                  setError("");
                }}
              >
                <ArrowLeft className="size-3.5 mr-1.5" />
                Back to sign in
              </Button>
            </form>
          </div>
        ) : (
          // Email & Password Sign In Screen
          <div>
            <div className="text-center">
              <h1 className="text-3xl font-bold tracking-tight">
                Sign In
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in to your account
              </p>
            </div>

            {configError && (
              <div className="rounded-md bg-destructive/15 p-4 border border-destructive/30 mt-6">
                <pre className="text-xs text-destructive whitespace-pre-wrap font-mono">
                  {configError}
                </pre>
              </div>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-6">
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="admin@example.com"
                            autoComplete="email"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="••••••••"
                            autoComplete="current-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {error && (
                  <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={form.formState.isSubmitting || !!configError}
                  className="w-full"
                >
                  {form.formState.isSubmitting ? "Signing in..." : "Sign in"}
                </Button>
              </form>
            </Form>
          </div>
        )}
      </div>
    </div>
  );
}
