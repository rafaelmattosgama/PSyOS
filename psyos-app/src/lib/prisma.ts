import { PrismaClient } from "@prisma/client";

const tenantScopedModels = new Set([
  "User",
  "Conversation",
  "Message",
  "AiPolicy",
  "AiEpisode",
  "Record",
  "AuditLog",
  "MfaChallenge",
  "WebAuthnCredential",
  "ConversationAccessGrant",
]);

const hasTenantScope = (where: unknown): boolean => {
  if (!where || typeof where !== "object") {
    return false;
  }

  const record = where as Record<string, unknown>;
  if (typeof record.tenantId === "string" && record.tenantId.length > 0) {
    return true;
  }

  const logicalKeys = ["AND", "OR", "NOT"] as const;
  for (const key of logicalKeys) {
    const value = record[key];
    if (Array.isArray(value) && value.some((item) => hasTenantScope(item))) {
      return true;
    }
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object" && hasTenantScope(value)) {
      return true;
    }
  }

  return false;
};

const createPrismaClient = () => {
  const client = new PrismaClient({
    log: ["error"],
  });

  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !tenantScopedModels.has(model)) {
            return query(args);
          }

          const action = operation;

          if (action === "create") {
            if (!args?.data?.tenantId) {
              throw new Error(`Tenant scope missing for ${model}.create`);
            }
          }

          if (action === "createMany") {
            const data = args?.data ?? [];
            const items = Array.isArray(data) ? data : [data];
            const hasTenantId = items.every((item) => Boolean(item?.tenantId));
            if (!hasTenantId) {
              throw new Error(`Tenant scope missing for ${model}.createMany`);
            }
          }

          const needsWhere = [
            "findMany",
            "findFirst",
            "findFirstOrThrow",
            "findUnique",
            "findUniqueOrThrow",
            "update",
            "updateMany",
            "delete",
            "deleteMany",
            "upsert",
          ];

          let allowMissingTenant = false;
          if (needsWhere.includes(action)) {
            allowMissingTenant = Boolean(
              (args as Record<string, unknown> | undefined)?.__allowMissingTenant,
            );
            const where = args?.where ?? {};
            if (!allowMissingTenant && !hasTenantScope(where)) {
              throw new Error(`Tenant scope missing for ${model}.${action}`);
            }
          }

          if (allowMissingTenant && args) {
            const sanitizedArgs = { ...(args as Record<string, unknown>) };
            delete sanitizedArgs.__allowMissingTenant;
            return query(sanitizedArgs);
          }

          return query(args);
        },
      },
    },
  });
};

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

const prismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prismaClient;
}

export const prisma = prismaClient;
