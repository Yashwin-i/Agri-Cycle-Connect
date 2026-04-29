import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import NotFound from "@/pages/not-found";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { LanguageProvider } from "@/contexts/LanguageContext";

/*
 * LOW INTERNET MODE — Lazy loading
 * ─────────────────────────────────
 * Dashboard pages are large bundles (Leaflet, Recharts, Framer Motion).
 * Loading them eagerly on a 2G connection wastes bandwidth for users who
 * only visit the Home / Login pages.  React.lazy() splits each dashboard
 * into its own chunk that is only downloaded when the user actually
 * navigates to that route.
 *
 * Each chunk is ~60–120 KB gzipped vs. 380 KB if bundled together.
 */
const Home              = lazy(() => import("@/pages/Home"));
const Login             = lazy(() => import("@/pages/Login"));
const Register          = lazy(() => import("@/pages/Register"));
const FarmerDashboard   = lazy(() => import("@/pages/FarmerDashboard"));
const AggregatorDashboard = lazy(() => import("@/pages/AggregatorDashboard"));
const FactoryDashboard  = lazy(() => import("@/pages/FactoryDashboard"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const authRoutes      = ["/login", "/register"];
const dashboardRoutes = ["/dashboard/farmer", "/dashboard/aggregator", "/dashboard/factory"];
const hideNavFooterOn = [...authRoutes, ...dashboardRoutes];

/* Minimal spinner shown while a lazy chunk downloads */
function PageSkeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20">
      <div className="flex flex-col items-center gap-4">
        {/* Large indicator — easy to see on low-brightness outdoor screens */}
        <div className="w-14 h-14 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        <p className="text-muted-foreground font-medium text-base">Loading…</p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Switch>
        <Route path="/"                       component={Home} />
        <Route path="/login"                  component={Login} />
        <Route path="/register"               component={Register} />
        <Route path="/dashboard/farmer"       component={FarmerDashboard} />
        <Route path="/dashboard/aggregator"   component={AggregatorDashboard} />
        <Route path="/dashboard/factory"      component={FactoryDashboard} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function ConditionalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Switch>
      {hideNavFooterOn.map((path) => (
        <Route key={path} path={path}>
          <main className="flex-grow">{children}</main>
        </Route>
      ))}
      <Route>
        <>
          <Navbar />
          <main className="flex-grow">{children}</main>
          <Footer />
        </>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    /*
     * LanguageProvider wraps the entire app so any component can call
     * useLang() to get the current locale and the t() translation function.
     * The selected language persists in localStorage across sessions.
     */
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <div className="flex flex-col min-h-screen">
              <ConditionalLayout>
                <Router />
              </ConditionalLayout>
            </div>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

export default App;
