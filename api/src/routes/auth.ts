import { Router } from "express";
import { z } from "zod";
import { signToken } from "../middleware/auth.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const users = [
  { username: "admin", password: "admin123!", role: "admin" as const, name: "SQL Admin" },
  { username: "viewer", password: "viewer123!", role: "viewer" as const, name: "Read Only" }
];

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload" });
    return;
  }
  const user = users.find((item) => item.username === parsed.data.username && item.password === parsed.data.password);
  if (!user) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }
  const token = signToken({ sub: user.username, role: user.role, name: user.name });
  res.json({ token, role: user.role, name: user.name });
});
