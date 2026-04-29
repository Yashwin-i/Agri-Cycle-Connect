# AgriCycle — Architecture & Project Notes

## Overview

AgriCycle is a digital platform to reduce stubble burning in Punjab by connecting three roles:

- **Farmers** upload field photos, receive AI biomass analysis, save/pin exact field GPS location, and request pickup.
- **Aggregators** view live farmer pickup requests, schedule pickups, optimise collection routes, open Google Maps directions, and submit negotiable price offers against factory procurement demands.
- **Factories** post biomass procurement demands, view nearby farmer requests, and manage demand status.

## Tech Stack

- **Monorepo**: pnpm workspaces
- **Frontend**: React 19 + Vite 7 + TypeScript
- **API**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: Phone number + password with cookie-based sessions
- **Maps**: Leaflet + OpenStreetMap/Esri satellite tiles, Google Maps links for road navigation
- **AI**: Google Gemini vision API for crop residue analysis
- **Accessibility**: English/Hindi/Punjabi language selector and text-to-speech controls

## Project Structure

```text
.
├── artifacts/
│   ├── api-server/         # Express API server
│   ├── agricycle/          # React + Vite frontend
│   └── mockup-sandbox/     # Component preview / design sandbox
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## App Routes

| Path | Description |
|------|-------------|
| `/` | Landing page |
| `/login` | Phone/password login |
| `/register` | Registration with name, phone, password, role, and language |
| `/dashboard/farmer` | AI biomass analysis, GPS field mapping, pickup requests |
| `/dashboard/aggregator` | Live requests, map, scheduling, route optimisation, price offers |
| `/dashboard/factory` | Procurement demand posting, regional requests, demand management |

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current session user |
| PUT | `/api/users/profile` | Update name/location/GPS profile |
| GET | `/api/pickup-requests` | List pickup requests (role-filtered) |
| POST | `/api/pickup-requests` | Farmer creates pickup request |
| PATCH | `/api/pickup-requests/:id/status` | Update request status |
| GET | `/api/factory-demands` | List factory demands |
| POST | `/api/factory-demands` | Factory posts demand |
| PATCH | `/api/factory-demands/:id` | Update demand |
| DELETE | `/api/factory-demands/:id` | Delete demand |
| POST | `/api/factory-demands/:id/bid` | Aggregator submits price offer |
| POST | `/api/ai/analyze` | Gemini vision crop residue analysis |

## Database Schema

- **`users`**: id, phone, name, role, location, lat, lng, password_hash, created_at, updated_at
- **`pickup_requests`**: farmer request details, crop/biomass values, GPS coordinates, status, scheduling, timestamps
- **`factory_demands`**: factory procurement demand details, coordinates, status, agreed price, matched aggregator, timestamps

## Key Design Decisions

- Farmer pickup requests use the farmer's saved/pinned field GPS point (mandatory before requesting pickup).
- Farmer field boundaries are estimated from acres by drawing a square area around the saved/pinned point on satellite imagery.
- Aggregator distance calculations use the aggregator's saved GPS location (Ludhiana as fallback only if no GPS exists).
- Route lines in the aggregator map are approximate straight-line planning visuals; Google Maps links provide road-by-road routing.
- Pickup requests have a **hold-until deadline**: farmer picks 3 / 7 / 14 days; aggregator must commit a pickup date within that window.
- Auto-cancel sweep runs before every list: cancels pending requests past hold-until, and accepted requests past committed pickup date.
- Cancellation increments `missedPickups` for the aggregator and credits `compensationCredits = 50` to the farmer.
