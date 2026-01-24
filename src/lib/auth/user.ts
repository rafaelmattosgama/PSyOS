import { prisma } from "@/lib/prisma";

export async function findUserByIdentifier(params: {
  tenantId: string;
  email?: string | null;
  phone?: string | null;
}) {
  if (params.email) {
    return prisma.user.findFirst({
      where: { tenantId: params.tenantId, email: params.email },
    });
  }
  if (params.phone) {
    return prisma.user.findFirst({
      where: { tenantId: params.tenantId, phone: params.phone },
    });
  }
  return null;
}
