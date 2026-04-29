import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Leaf, ChevronDown, ChevronUp, Sprout, Flame, Recycle, Beef, Factory } from "lucide-react";

interface Method {
  id: string;
  icon: React.ReactNode;
  title: string;
  earn: string;
  co2: string;
  difficulty: "Easy" | "Medium" | "Hard";
  steps: string[];
  contact?: string;
}

const METHODS: Method[] = [
  {
    id: "compost",
    icon: <Sprout className="w-5 h-5" />,
    title: "In-field composting",
    earn: "Saves ₹3,000–₹5,000/acre on next crop fertilizer",
    co2: "Adds organic carbon back to soil",
    difficulty: "Easy",
    steps: [
      "Spread stubble evenly across the field (5–8 cm thick).",
      "Spray Pusa Decomposer (4 capsules + 150 g jaggery + 5 L water per acre).",
      "Lightly irrigate to keep moist; decomposes in 20–25 days.",
      "Sow next crop directly — no need to remove residue.",
    ],
    contact: "Pusa Decomposer kits: free from your local Krishi Vigyan Kendra (KVK).",
  },
  {
    id: "happy-seeder",
    icon: <Recycle className="w-5 h-5" />,
    title: "Happy Seeder / Super Seeder mulching",
    earn: "₹0 disposal cost · saves tillage diesel",
    co2: "Retains residue as protective mulch — improves yield",
    difficulty: "Medium",
    steps: [
      "Hire a Happy Seeder tractor attachment from your nearest custom-hiring centre.",
      "Sow wheat directly into standing/loose stubble in one pass.",
      "Stubble decomposes in field, conserves soil moisture.",
    ],
    contact: "Punjab CHC subsidy: 50–80% on Happy Seeder rental. Call your block agriculture officer.",
  },
  {
    id: "biogas",
    icon: <Factory className="w-5 h-5" />,
    title: "Sell to bio-CNG / biomass plant",
    earn: "₹1,500–₹2,500 per tonne",
    co2: "Replaces fossil fuel — net negative emissions",
    difficulty: "Easy",
    steps: [
      "Bale the stubble using a baler (CHC rental available).",
      "Contact Punjab Energy Development Agency (PEDA) for nearest off-taker.",
      "Truck pickup is usually arranged by the buyer for ≥10 tonnes.",
    ],
    contact: "PEDA helpline: 0172-2663328 · IOCL Talwandi Sabo bio-CNG plant accepts paddy stubble.",
  },
  {
    id: "fodder",
    icon: <Beef className="w-5 h-5" />,
    title: "Livestock fodder",
    earn: "₹800–₹1,500 per tonne (wheat straw mostly)",
    co2: "Avoids burning entirely",
    difficulty: "Easy",
    steps: [
      "Wheat & barley straw can be sold directly to dairy farms.",
      "Paddy straw needs to be treated with 4% urea solution to be edible.",
      "Local dairies and gaushalas are usually buyers.",
    ],
    contact: "Punjab Dairy Federation: contact your district MILKFED office.",
  },
  {
    id: "mushroom",
    icon: <Leaf className="w-5 h-5" />,
    title: "Mushroom cultivation substrate",
    earn: "Side-income ₹40,000+ / cycle if you grow yourself",
    co2: "Stubble becomes spent compost — sold as fertilizer after",
    difficulty: "Hard",
    steps: [
      "Chop stubble, soak 24h, mix with wheat bran + lime.",
      "Pasteurise the substrate (60-65°C for 4-6 hours).",
      "Spawn with oyster or button mushroom seed.",
      "Harvest in 25–35 days in a dark, humid shed.",
    ],
    contact: "Punjab Agricultural University offers free 3-day training. Call: 0161-2401960.",
  },
  {
    id: "brick-kiln",
    icon: <Flame className="w-5 h-5" />,
    title: "Sell to brick kilns",
    earn: "₹1,200–₹1,800 per tonne",
    co2: "Replaces coal in kilns — major emissions cut",
    difficulty: "Easy",
    steps: [
      "Bale or loose-pack the stubble.",
      "Contact nearby brick kilns directly — most accept paddy straw as fuel.",
      "Bulk pickup arranged for full truckloads.",
    ],
    contact: "Visit your nearest brick kiln cluster (most Punjab districts have 20+).",
  },
];

export function DisposalMethods({ biomassTons }: { biomassTons: number }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const earnEstimate = (perTonLow: number, perTonHigh: number) => {
    const low = Math.round(perTonLow * biomassTons);
    const high = Math.round(perTonHigh * biomassTons);
    return `₹${low.toLocaleString()} – ₹${high.toLocaleString()}`;
  };

  return (
    <div className="mt-3 rounded-2xl bg-white/80 border-2 border-emerald-300 overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-600 to-green-600 text-white px-4 py-2.5 flex items-center gap-2">
        <Leaf className="w-4 h-4" />
        <p className="font-bold text-sm">Don't burn it — try these instead</p>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-xs text-emerald-900 bg-emerald-50 rounded-lg p-2 font-medium">
          You have <strong>{biomassTons.toFixed(1)} tonnes</strong> of stubble that no aggregator picked up.
          Burning is illegal in Punjab (₹2,500–₹15,000 fine + criminal record). Here are legal, profitable alternatives:
        </p>

        {METHODS.map((m) => {
          const isOpen = openId === m.id;
          let estimate = m.earn;
          if (m.id === "biogas") estimate = `${earnEstimate(1500, 2500)} (${m.earn})`;
          if (m.id === "fodder") estimate = `${earnEstimate(800, 1500)} (${m.earn})`;
          if (m.id === "brick-kiln") estimate = `${earnEstimate(1200, 1800)} (${m.earn})`;

          return (
            <div key={m.id} className="rounded-xl border border-emerald-200 bg-white overflow-hidden">
              <button
                onClick={() => setOpenId(isOpen ? null : m.id)}
                className="w-full p-3 flex items-start gap-3 hover:bg-emerald-50 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  {m.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm text-emerald-950">{m.title}</p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      m.difficulty === "Easy" ? "bg-green-100 text-green-800" :
                      m.difficulty === "Medium" ? "bg-amber-100 text-amber-800" :
                      "bg-red-100 text-red-800"
                    }`}>{m.difficulty}</span>
                  </div>
                  <p className="text-xs text-emerald-800 mt-0.5">{estimate}</p>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-emerald-600 mt-1 shrink-0" /> : <ChevronDown className="w-4 h-4 text-emerald-600 mt-1 shrink-0" />}
              </button>
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-emerald-100 bg-emerald-50/50"
                  >
                    <div className="p-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase text-emerald-700">CO₂ benefit</p>
                      <p className="text-xs text-emerald-900">{m.co2}</p>
                      <p className="text-[11px] font-bold uppercase text-emerald-700 mt-2">How to do it</p>
                      <ol className="text-xs text-emerald-900 space-y-1 list-decimal list-inside">
                        {m.steps.map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                      {m.contact && (
                        <div className="mt-2 text-xs bg-white border border-emerald-200 rounded-lg p-2 text-emerald-900">
                          <strong>Contact:</strong> {m.contact}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
