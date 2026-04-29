/**
 * Login.tsx
 *
 * ACCESSIBILITY & RURAL USABILITY
 * ─────────────────────────────────
 * • LanguageSelector at top — a farmer who can't read English must be
 *   able to switch language BEFORE seeing any English text on this page.
 * • SpeakButton beside the main heading reads the page purpose aloud.
 * • Labels and inputs use text-base (16 px) — large enough to read
 *   outdoors on a phone screen in bright sunlight.
 * • h-14 buttons (56 px) exceed the WCAG 2.5.5 44 px minimum touch target.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Leaf, AlertCircle, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LanguageSelector } from "@/components/LanguageSelector";
import { SpeakButton } from "@/components/SpeakButton";
import { useLang } from "@/contexts/LanguageContext";

const roleDashboard: Record<string, string> = {
  farmer: "/dashboard/farmer",
  aggregator: "/dashboard/aggregator",
  factory: "/dashboard/factory",
};

export default function Login() {
  const [, setLocation]  = useLocation();
  const queryClient      = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { t }            = useLang();

  const loginSchema = z.object({
    phone:    z.string().min(7, t("phoneLabel")),
    password: z.string().min(1, t("passwordLabel")),
  });
  type LoginForm = z.infer<typeof loginSchema>;

  const { register, handleSubmit, formState: { errors } } =
    useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        // Prime the cache with the just-returned user so the dashboard
        // guard sees authenticated state immediately, instead of briefly
        // observing the previous "not authenticated" error and bouncing
        // back to /login.
        queryClient.setQueryData(getGetMeQueryKey(), data.user);
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation(roleDashboard[data.user.role] ?? "/dashboard/farmer");
      },
      onError: (error: any) => {
        const msg =
          error?.data?.error ??
          error?.response?.data?.error ??
          error?.message ??
          t("invalidCreds");
        setServerError(msg);
      },
    },
  });

  const onSubmit = (data: LoginForm) => {
    setServerError(null);
    loginMutation.mutate({ data });
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `url(${import.meta.env.BASE_URL}images/pattern-bg.png)`,
          backgroundSize: "cover",
        }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md relative z-10"
      >
        {/*
         * Language selector sits ABOVE the card so it is the very first
         * interactive element on the page.  A farmer who can't read English
         * can switch immediately without deciphering any form labels.
         */}
        <div className="flex justify-center mb-4">
          <LanguageSelector />
        </div>

        <div className="bg-card border shadow-xl shadow-black/5 rounded-3xl p-8 sm:p-10">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <Link href="/">
              <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/25">
                <Leaf className="w-8 h-8 text-white" />
              </div>
            </Link>
          </div>

          <div className="text-center mb-8">
            <h1 className="text-3xl font-display font-bold text-foreground mb-2">
              {t("welcomeBack")}
            </h1>
            <p className="text-muted-foreground">{t("signInSubtitle")}</p>
            {/* TTS button reads the page purpose — helps low-literacy users */}
            <div className="flex justify-center mt-3">
              <SpeakButton text={`${t("welcomeBack")}. ${t("signInSubtitle")}`} />
            </div>
          </div>

          {serverError && (
            <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3 text-destructive">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{serverError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              {/*
               * text-base (16 px) label — outdoor readability.
               * iOS Safari auto-zooms inputs smaller than 16 px; this avoids
               * that jarring behaviour on farm visits in bright sunlight.
               */}
              <label className="block text-base font-semibold text-foreground mb-2 pl-1">
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="w-4 h-4" /> {t("phoneLabel")}
                </span>
              </label>
              <Input
                type="tel"
                placeholder={t("phonePlaceholder")}
                error={!!errors.phone}
                className="h-14 text-base rounded-xl"
                {...register("phone")}
              />
              {errors.phone && (
                <p className="text-destructive text-sm mt-1.5 pl-1">{errors.phone.message}</p>
              )}
            </div>

            <div>
              <label className="block text-base font-semibold text-foreground mb-2 pl-1">
                {t("passwordLabel")}
              </label>
              <Input
                type="password"
                placeholder={t("passwordPlaceholder")}
                error={!!errors.password}
                className="h-14 text-base rounded-xl"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-destructive text-sm mt-1.5 pl-1">{errors.password.message}</p>
              )}
            </div>

            {/*
             * h-14 = 56 px button height — comfortably above the 44 px WCAG
             * minimum, important for users with motor impairment or older phones
             * with imprecise touch sensors.
             */}
            <Button
              type="submit"
              className="w-full rounded-xl h-14 text-lg font-bold mt-2"
              isLoading={loginMutation.isPending}
            >
              {t("signInButton")}
            </Button>
          </form>

          <p className="text-center text-muted-foreground text-base mt-8">
            {t("noAccount")}{" "}
            <Link href="/register" className="font-bold text-primary hover:underline">
              {t("createOne")}
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
