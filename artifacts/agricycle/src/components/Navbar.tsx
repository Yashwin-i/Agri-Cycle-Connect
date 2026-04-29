import { Link, useLocation } from "wouter"
import { Leaf, LogOut, User as UserIcon } from "lucide-react"
import { Button } from "./ui/button"
import { useGetMe, useLogout, getGetMeQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { motion } from "framer-motion"

export function Navbar() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  const { data: user, isLoading } = useGetMe({
    query: { retry: false }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation("/");
      }
    }
  });

  return (
    <motion.nav 
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-0 left-0 right-0 z-50 glass-card border-b-0 border-t-0 border-x-0"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          
          <Link href="/" className="flex items-center space-x-2 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform duration-300">
              <Leaf className="w-6 h-6 text-white" />
            </div>
            <span className="font-display font-bold text-2xl tracking-tight text-foreground group-hover:text-primary transition-colors">
              AgriCycle
            </span>
          </Link>

          <div className="hidden md:flex items-center space-x-8">
            <Link href="/" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">Home</Link>
            <a href="#how-it-works" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">How it Works</a>
            <a href="#impact" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Impact</a>
          </div>

          <div className="flex items-center space-x-4">
            {!isLoading && (
              user ? (
                <div className="flex items-center space-x-4">
                  <Link href="/dashboard" className="flex items-center space-x-2 text-sm font-medium hover:text-primary transition-colors">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <UserIcon className="w-4 h-4 text-primary" />
                    </div>
                    <span className="hidden sm:inline">{user.name}</span>
                  </Link>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => logoutMutation.mutate()}
                    title="Log out"
                  >
                    <LogOut className="w-5 h-5 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <>
                  <Link href="/login" className="text-sm font-medium text-foreground hover:text-primary transition-colors hidden sm:block">
                    Log in
                  </Link>
                  <Button onClick={() => setLocation("/register")} className="rounded-full shadow-lg shadow-primary/20">
                    Get Started
                  </Button>
                </>
              )
            )}
          </div>

        </div>
      </div>
    </motion.nav>
  )
}
