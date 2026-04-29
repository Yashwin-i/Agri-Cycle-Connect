import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

/* ─── GET /api/users/factories ──────────────────────────────────
   Lightweight directory of factories — used by aggregators to pick
   a target factory when sending a load offer.                      */
router.get("/factories", requireAuth, async (_req, res) => {
  const rows = await db
    .select({
      id:       usersTable.id,
      name:     usersTable.name,
      location: usersTable.location,
      lat:      usersTable.lat,
      lng:      usersTable.lng,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "factory"))
    .orderBy(asc(usersTable.name));
  res.json({ factories: rows });
});

const UpdateProfileSchema = z.object({
  name:     z.string().min(2).optional(),
  location: z.string().min(2).optional(),
  lat:      z.number().optional().nullable(),
  lng:      z.number().optional().nullable(),
});

router.put("/profile", requireAuth, async (req, res) => {
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request data" });
    return;
  }

  const currentUser = (req as any).user;
  const updates: Record<string, any> = {};
  if (parsed.data.name)     updates.name     = parsed.data.name;
  if (parsed.data.location) updates.location = parsed.data.location;
  if (parsed.data.lat !== undefined) updates.lat = parsed.data.lat;
  if (parsed.data.lng !== undefined) updates.lng = parsed.data.lng;

  if (Object.keys(updates).length === 0) {
    res.json(currentUser);
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, currentUser.id))
    .returning();

  res.json({
    id:        updated.id,
    name:      updated.name,
    phone:     updated.phone,
    role:      updated.role,
    location:  updated.location,
    lat:       updated.lat ?? null,
    lng:       updated.lng ?? null,
    createdAt: updated.createdAt,
  });
});

export default router;
