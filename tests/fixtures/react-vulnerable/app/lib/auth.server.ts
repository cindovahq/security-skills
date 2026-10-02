import { redirect } from "react-router";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { db, type Role } from "./db.server";
import { getSession } from "./session.server";

export function verifyPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  const candidate = scryptSync(password, Buffer.from(salt, "base64"), 16).toString("hex");
  return candidate.length === hash.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

export async function getUser(request: Request) {
  const session = await getSession(request.headers.get("Cookie"));
  const userId = session.get("userId");
  return userId ? db.user.byId(userId) : null;
}

export async function requireUser(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  return user;
}

export async function requireRole(request: Request, role: Role) {
  const user = await requireUser(request);
  if (user.role !== role) throw new Response("Forbidden", { status: 403 });
  return user;
}
