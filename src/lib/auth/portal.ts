import type { Role, User } from "@prisma/client";

export const roleHome: Record<Role, string> = {
  ADMIN: "/admin",
  PSYCHOLOGIST: "/app",
  PATIENT: "/patient",
};

export const resolveHomeForUser = (user: Pick<User, "role" | "isSystemAdmin">) =>
  user.isSystemAdmin ? "/system" : roleHome[user.role];
