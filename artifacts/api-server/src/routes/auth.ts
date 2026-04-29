import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { setSession, clearSession } from "../lib/session";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

function safeUser(user: typeof usersTable.$inferSelect) {
  return {
    id:        user.id,
    name:      user.name,
    phone:     user.phone,
    role:      user.role,
    location:  user.location,
    lat:       user.lat ?? null,
    lng:       user.lng ?? null,
    createdAt: user.createdAt,
  };
}

router.post("/register", async (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request data" });
    return;
  }

  const { name, phone, password, role, location } = parsed.data;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
  if (existing) {
    res.status(409).json({ error: "Phone number already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({ name, phone, passwordHash, role, location }).returning();

  setSession(res, user.id);
  res.status(201).json({ user: safeUser(user), message: "Registration successful" });
});

router.post("/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request data" });
    return;
  }

  const { phone, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
  if (!user) {
    res.status(401).json({ error: "Invalid phone number or password" });
    return;
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    res.status(401).json({ error: "Invalid phone number or password" });
    return;
  }

  setSession(res, user.id);
  res.json({ user: safeUser(user), message: "Login successful" });
});

router.post("/logout", (req, res) => {
  clearSession(res);
  res.json({ message: "Logged out successfully" });
});

router.get("/me", requireAuth, (req, res) => {
  const user = (req as any).user;
  res.json(safeUser(user));
});

export default router;
