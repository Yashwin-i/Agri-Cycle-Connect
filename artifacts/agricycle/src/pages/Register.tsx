/**
 * Register.tsx
 *
 * ACCESSIBILITY & RURAL USABILITY
 * ─────────────────────────────────
 * • LanguageSelector above the form — same rationale as Login.tsx.
 *   A first-time user who cannot read English must be able to switch
 *   language before attempting to fill in their details.
 * • Role cards use large icons (w-12 h-12) and bold text — essential
 *   for users with poor fine-motor control on low-cost touchscreens.
 * • h-14 submit button (56 px) for easy tapping in field conditions.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Leaf, Tractor, Truck, Factory, AlertCircle, CheckCircle2, MapPin, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRegister, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLang } from "@/contexts/LanguageContext";

const roleDashboard: Record<string, string> = {
  farmer: "/dashboard/farmer",
  aggregator: "/dashboard/aggregator",
  factory: "/dashboard/factory",
};

export default function Register() {
  const [, setLocation] = useLocation();
  const queryClient     = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { t }           = useLang();

  const registerSchema = z.object({
    name:     z.string().min(2),
    phone:    z.string().min(7),
    password: z.string().min(6),
    role:     z.enum(["farmer", "aggregator", "factory"], {
      required_error: t("selectRole"),
    }),
    location: z.string().min(2),
  });
  type RegisterForm = z.infer<typeof registerSchema>;

  const { register, handleSubmit, control, watch, formState: { errors } } =
    useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const selectedRole = watch("role");

  const registerMutation = useRegister({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation(roleDashboard[data.user.role] ?? "/dashboard/farmer");
      },
      onError: (error: any) => {
        setServerError(
          error?.response?.data?.error ||
          "Registration failed. Phone number might already be in use."
        );
      },
    },
  });

  const onSubmit = (data: RegisterForm) => {
    setServerError(null);
    registerMutation.mutate({ data });
  };

  const roles = [
    {
      id: "farmer" as const,
      title: t("roleFarmer"),
      icon: Tractor,
      desc: t("roleFarmerDesc"),
      badge: t("roleFarmerBadge"),
    },
    {
      id: "aggregator" as const,
      title: t("roleAggregator"),
      icon: Truck,
      desc: t("roleAggregatorDesc"),
      badge: t("roleAggregatorBadge"),
    },
    {
      id: "factory" as const,
      title: t("roleFactory"),
      icon: Factory,
      desc: t("roleFactoryDesc"),
      badge: t("roleFactoryBadge"),
    },
  ];

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4 sm:p-8 relative overflow-hidden py-16">
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `url(${import.meta.env.BASE_URL}images/pattern-bg.png)`,
          backgroundSize: "cover",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="w-full max-w-3xl relative z-10"
      >
        {/*
         * Language picker is the first element so non-English speakers
         * can switch before encountering any English form labels.
         */}
        <div className="flex justify-center mb-4">
          <LanguageSelector />
        </div>

        <div className="bg-card border shadow-xl shadow-black/5 rounded-[2rem] p-6 sm:p-12">
          <div className="flex justify-center mb-8">
            <Link href="/">
              <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/25">
                <Leaf className="w-8 h-8 text-white" />
              </div>
            </Link>
          </div>

          <div className="text-center mb-10">
            <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-2">
              {t("joinTitle")}
            </h1>
            <p className="text-muted-foreground text-lg">{t("joinSubtitle")}</p>
          </div>

          {serverError && (
            <div className="mb-8 p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3 text-destructive">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="font-medium">{serverError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-base font-semibold text-foreground mb-2 pl-1">
                  {t("fullNameLabel")}
                </label>
                <Input
                  placeholder={t("fullNamePlaceholder")}
                  error={!!errors.name}
                  className="h-14 text-base rounded-xl"
                  {...register("name")}
                />
                {errors.name && (
                  <p className="text-destructive text-sm mt-1.5 pl-1">{errors.name.message}</p>
                )}
              </div>

              <div>
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-base font-semibold text-foreground mb-2 pl-1">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" /> {t("locationLabel")}
                  </span>
                </label>
                <Input
                  placeholder={t("locationPlaceholder")}
                  error={!!errors.location}
                  className="h-14 text-base rounded-xl"
                  {...register("location")}
                />
                {errors.location && (
                  <p className="text-destructive text-sm mt-1.5 pl-1">{errors.location.message}</p>
                )}
              </div>

              <div>
                <label className="block text-base font-semibold text-foreground mb-2 pl-1">
                  {t("passwordLabel")}
                </label>
                <Input
                  type="password"
                  placeholder={t("passwordMinHint")}
                  error={!!errors.password}
                  className="h-14 text-base rounded-xl"
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-destructive text-sm mt-1.5 pl-1">{errors.password.message}</p>
                )}
              </div>
            </div>

            {/* Role Selection */}
            <div>
              <label className="block text-lg font-bold text-foreground mb-4 pl-1">
                {t("selectRole")}
              </label>
              <Controller
                name="role"
                control={control}
                render={({ field }) => (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {roles.map((role) => {
                      const Icon = role.icon;
                      const isSelected = field.value === role.id;
                      return (
                        <div
                          key={role.id}
                          onClick={() => field.onChange(role.id)}
                          /*
                           * Large tap target (min-h-[120px]) and bold label.
                           * Rural users may be selecting roles for the first
                           * time — the icon makes the option self-explanatory
                           * without reading the text description.
                           */
                          className={cn(
                            "relative cursor-pointer rounded-2xl border-2 p-5 flex flex-col items-start transition-all duration-200 select-none min-h-[120px]",
                            isSelected
                              ? "border-primary bg-primary/5 shadow-md shadow-primary/10 scale-[1.02]"
                              : "border-border bg-background hover:border-primary/40 hover:bg-muted/50"
                          )}
                        >
                          {isSelected && (
                            <div className="absolute top-4 right-4 text-primary">
                              <CheckCircle2 className="w-5 h-5 fill-primary text-white" />
                            </div>
                          )}
                          <div className={cn(
                            "w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors",
                            isSelected ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                          )}>
                            <Icon className="w-6 h-6" />
                          </div>
                          <span className="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-1">
                            {role.badge}
                          </span>
                          <h4 className="font-bold text-foreground mb-1 text-base">{role.title}</h4>
                          <p className="text-sm text-muted-foreground leading-snug">{role.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              />
              {errors.role && (
                <p className="text-destructive text-sm mt-3 pl-1 font-medium text-center">
                  {errors.role.message}
                </p>
              )}
            </div>

            <div className="pt-4 border-t">
              <Button
                type="submit"
                className="w-full rounded-xl h-14 text-lg font-bold"
                isLoading={registerMutation.isPending}
              >
                {t("createAccount")}
              </Button>
              {selectedRole && (
                <p className="text-center text-sm text-muted-foreground mt-3">
                  {t("alreadyHaveAccount")}{" "}
                  <span className="font-semibold text-primary capitalize">{selectedRole}</span>
                </p>
              )}
            </div>
          </form>

          <p className="text-center text-muted-foreground text-base mt-8">
            {t("alreadyHaveAccount")}{" "}
            <Link href="/login" className="font-bold text-primary hover:underline">
              {t("signIn")}
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
