import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { Tractor, Truck, Factory, MapPin, Plus, List, Settings, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading, isError } = useGetMe({
    query: { retry: false }
  });

  useEffect(() => {
    if (isError) {
      setLocation("/login");
    }
  }, [isError, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) return null;

  const getRoleConfig = (role: string) => {
    switch(role) {
      case 'farmer':
        return {
          icon: <Tractor className="w-8 h-8 text-primary" />,
          title: "Farmer Dashboard",
          primaryAction: "List New Residue",
          primaryIcon: <Plus className="w-4 h-4 mr-2" />,
          stats: [
            { label: "Active Listings", value: "2", trend: "+1 this week" },
            { label: "Total Sold (Tons)", value: "45", trend: "+12% vs last month" },
            { label: "Earnings", value: "$1,250", trend: "Payment received" }
          ]
        };
      case 'aggregator':
        return {
          icon: <Truck className="w-8 h-8 text-secondary" />,
          title: "Aggregator Hub",
          primaryAction: "Find Available Biomass",
          primaryIcon: <MapPin className="w-4 h-4 mr-2" />,
          stats: [
            { label: "Pending Collections", value: "8", trend: "Requires attention" },
            { label: "Processed (Tons)", value: "320", trend: "+45% vs last month" },
            { label: "Active Contracts", value: "3", trend: "With 2 factories" }
          ]
        };
      case 'factory':
        return {
          icon: <Factory className="w-8 h-8 text-accent-foreground" />,
          title: "Procurement Center",
          primaryAction: "Post Requirement",
          primaryIcon: <List className="w-4 h-4 mr-2" />,
          stats: [
            { label: "Biomass Inventory", value: "1,200 t", trend: "14 days supply" },
            { label: "CO2 Offset", value: "480 tons", trend: "Green cert verified" },
            { label: "Active Deliveries", value: "5", trend: "Arriving today" }
          ]
        };
      default:
        return {
          icon: <Settings className="w-8 h-8" />,
          title: "Dashboard",
          primaryAction: "View Profile",
          primaryIcon: <Settings className="w-4 h-4 mr-2" />,
          stats: []
        };
    }
  };

  const config = getRoleConfig(user.role);

  return (
    <div className="min-h-screen pt-24 pb-12 bg-muted/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4"
        >
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-white shadow-sm border flex items-center justify-center">
              {config.icon}
            </div>
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground">{config.title}</h1>
              <p className="text-muted-foreground text-lg">Welcome back, {user.name}!</p>
            </div>
          </div>
          <Button size="lg" className="rounded-xl shadow-lg shrink-0">
            {config.primaryIcon}
            {config.primaryAction}
          </Button>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10"
        >
          {config.stats.map((stat, i) => (
            <div key={i} className="bg-card rounded-2xl p-6 border shadow-sm hover:shadow-md transition-shadow">
              <p className="text-sm font-medium text-muted-foreground mb-2">{stat.label}</p>
              <h3 className="text-3xl font-display font-bold text-foreground mb-2">{stat.value}</h3>
              <div className="flex items-center text-sm font-medium text-primary">
                <TrendingUp className="w-4 h-4 mr-1.5" />
                {stat.trend}
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card rounded-3xl p-8 border shadow-sm min-h-[400px]"
        >
          <div className="flex justify-between items-center mb-8 border-b pb-6">
            <h2 className="text-2xl font-bold font-display">Recent Activity</h2>
            <Button variant="outline" size="sm">View All</Button>
          </div>
          
          <div className="flex flex-col items-center justify-center text-center h-64 text-muted-foreground">
            <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <List className="w-8 h-8 opacity-20" />
            </div>
            <p className="text-lg font-medium text-foreground mb-1">No activity yet</p>
            <p>Your platform interactions will appear here.</p>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
