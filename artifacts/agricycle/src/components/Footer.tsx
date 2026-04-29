import { Leaf } from "lucide-react"
import { useLocation } from "wouter"

export function Footer() {
  const [, setLocation] = useLocation();

  return (
    <footer className="bg-foreground text-muted pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Leaf className="w-5 h-5 text-white" />
              </div>
              <span className="font-display font-bold text-xl text-white">
                AgriCycle
              </span>
            </div>
            <p className="text-muted-foreground max-w-sm leading-relaxed">
              Turning agricultural waste into opportunity. We connect farmers, biomass aggregators, and eco-friendly factories to build a sustainable future and eliminate stubble burning.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-white mb-6">Platform</h4>
            <ul className="space-y-4">
              <li>
                <button onClick={() => setLocation('/login')} className="text-muted-foreground hover:text-white transition-colors">For Farmers</button>
              </li>
              <li>
                <button onClick={() => setLocation('/login')} className="text-muted-foreground hover:text-white transition-colors">For Aggregators</button>
              </li>
              <li>
                <button onClick={() => setLocation('/login')} className="text-muted-foreground hover:text-white transition-colors">For Factories</button>
              </li>
            </ul>
          </div>

        </div>
        
        <div className="border-t border-white/10 pt-8">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} AgriCycle. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
