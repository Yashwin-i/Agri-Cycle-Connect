import { motion } from "framer-motion"
import { useLocation } from "wouter"
import { useEffect } from "react"
import { 
  ArrowRight, 
  Tractor, 
  Truck, 
  Factory, 
  Sprout, 
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useGetMe } from "@workspace/api-client-react"

const ROLE_DASHBOARD: Record<string, string> = {
  farmer:     "/dashboard/farmer",
  aggregator: "/dashboard/aggregator",
  factory:    "/dashboard/factory",
};

const fadeInUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.2 }
  }
};

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe({ query: { retry: false } });

  // Logged-in users shouldn't see the marketing landing page —
  // bounce them straight to their role dashboard.
  useEffect(() => {
    if (user && (user as any).role) {
      const dest = ROLE_DASHBOARD[(user as any).role as string];
      if (dest) setLocation(dest, { replace: true });
    }
  }, [user, setLocation]);

  if (isLoading || (user && (user as any).role && ROLE_DASHBOARD[(user as any).role as string])) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-20">
      {/* HERO SECTION */}
      <section className="relative min-h-[90vh] flex items-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
            alt="Beautiful agricultural landscape" 
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/80 to-transparent" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <motion.div 
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
            className="max-w-2xl"
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-primary/10 text-primary font-medium text-sm mb-6 border border-primary/20">
              <Sprout className="w-4 h-4" />
              <span>Sustainable Agriculture</span>
            </motion.div>
            
            <motion.h1 variants={fadeInUp} className="text-5xl sm:text-6xl lg:text-7xl font-display font-extrabold text-foreground leading-tight mb-6">
              Stop burning. <br />
              Start <span className="text-gradient">earning.</span>
            </motion.h1>
            
            <motion.p variants={fadeInUp} className="text-lg sm:text-xl text-muted-foreground mb-10 leading-relaxed max-w-xl">
              Every year, millions of tons of crop residue are burned, causing severe air pollution. AgriCycle transforms this waste into valuable biomass, connecting farmers with industries that need it.
            </motion.p>
            
            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
              <Button size="lg" className="rounded-full shadow-xl shadow-primary/25" onClick={() => setLocation('/register')}>
                Get Started Now <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button size="lg" variant="outline" className="rounded-full bg-white/50 backdrop-blur-sm" onClick={() => {
                document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
              }}>
                Learn More
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="py-24 bg-white relative">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/pattern-bg.png)` }} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">How AgriCycle Works</h2>
            <p className="text-muted-foreground text-lg">A seamless ecosystem that benefits everyone while protecting the environment.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
            {/* Two connector lines between the icons, skipping the middle icon */}
            <div
              className="hidden md:block absolute h-0.5 bg-gradient-to-r from-primary/40 to-primary/20"
              style={{ top: '48px', left: 'calc(16.67% + 54px)', width: 'calc(33.33% - 108px)' }}
            />
            <div
              className="hidden md:block absolute h-0.5 bg-gradient-to-r from-primary/20 to-secondary/40"
              style={{ top: '48px', left: 'calc(50% + 54px)', width: 'calc(33.33% - 108px)' }}
            />

            <div className="relative flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 relative z-10 border border-primary/20 shadow-lg shadow-primary/5">
                <Tractor className="w-10 h-10 text-primary" />
                <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-bold border-4 border-white">1</div>
              </div>
              <h3 className="text-xl font-bold mb-3">Farmers List Residue</h3>
              <p className="text-muted-foreground">Instead of burning, farmers quickly log their available crop stubble via our mobile-friendly app.</p>
            </div>

            <div className="relative flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-2xl bg-secondary/10 flex items-center justify-center mb-6 relative z-10 border border-secondary/20 shadow-lg shadow-secondary/5">
                <Truck className="w-10 h-10 text-secondary" />
                <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-secondary text-white flex items-center justify-center font-bold border-4 border-white">2</div>
              </div>
              <h3 className="text-xl font-bold mb-3">Aggregators Collect</h3>
              <p className="text-muted-foreground">Local entrepreneurs bid on listings, bring balers, collect the biomass, and process it efficiently.</p>
            </div>

            <div className="relative flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-2xl bg-accent/20 flex items-center justify-center mb-6 relative z-10 border border-accent/30 shadow-lg shadow-accent/10">
                <Factory className="w-10 h-10 text-accent-foreground" />
                <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-bold border-4 border-white">3</div>
              </div>
              <h3 className="text-xl font-bold mb-3">Factories Purchase</h3>
              <p className="text-muted-foreground">Industries buy processed biomass as a sustainable alternative to coal and fossil fuels.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ROLES SECTION */}
      <section className="py-24 bg-muted/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Choose Your Role</h2>
            <p className="text-muted-foreground text-lg max-w-2xl">Join the ecosystem in a capacity that fits your business. Everyone plays a part in building a greener future.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <RoleCard 
              icon={<Tractor />}
              title="For Farmers"
              description="Clear your fields without fines or environmental damage. Earn extra income from what used to be waste."
              color="primary"
            />
            <RoleCard 
              icon={<Truck />}
              title="For Aggregators"
              description="Build a profitable logistics business. Use our routing tools to efficiently collect and deliver biomass."
              color="secondary"
            />
            <RoleCard 
              icon={<Factory />}
              title="For Factories"
              description="Secure a reliable supply of green energy. Reduce your carbon footprint and meet sustainability goals."
              color="accent"
            />
          </div>
        </div>
      </section>

      {/* IMPACT SECTION */}
      <section id="impact" className="py-24 bg-foreground text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-32 -mt-32 w-96 h-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 -ml-32 -mb-32 w-96 h-96 rounded-full bg-secondary/20 blur-3xl" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 leading-tight">
              Measurable impact for a <span className="text-primary">greener planet.</span>
            </h2>
            <p className="text-white/70 text-lg mb-10 leading-relaxed">
              By participating in AgriCycle, you are directly contributing to the reduction of airborne particulate matter, saving thousands of lives, and creating a circular rural economy.
            </p>
            <Button size="lg" variant="accent" onClick={() => setLocation('/register')} className="rounded-full text-foreground font-bold">
              Join the Movement
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function RoleCard({ icon, title, description, color }: { icon: React.ReactNode, title: string, description: string, color: 'primary' | 'secondary' | 'accent' }) {
  const [, setLocation] = useLocation();
  const colorMap = {
    primary: "from-primary/20 to-primary/5 text-primary border-primary/20 hover:border-primary/50",
    secondary: "from-secondary/20 to-secondary/5 text-secondary border-secondary/20 hover:border-secondary/50",
    accent: "from-accent/30 to-accent/5 text-accent-foreground border-accent/30 hover:border-accent/60"
  };

  return (
    <div className={`bg-card rounded-2xl p-8 shadow-lg shadow-black/5 border transition-all duration-300 hover:shadow-xl hover:-translate-y-1 flex flex-col h-full ${colorMap[color].split(' ').slice(2).join(' ')}`}>
      <div className={`w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center mb-6 ${colorMap[color].split(' ').slice(0, 2).join(' ')} [&>svg]:w-7 [&>svg]:h-7`}>
        {icon}
      </div>
      <h3 className="text-2xl font-bold mb-3">{title}</h3>
      <p className="text-muted-foreground flex-grow mb-8">{description}</p>
      <Button variant="outline" className="w-full justify-between group" onClick={() => setLocation('/login')}>
        Login / Sign Up <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </Button>
    </div>
  )
}
