import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";

const createSchema = z.object({
  name: z.string().min(1),
  adminEmail: z.string().email().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.isSystemAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    items: tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      createdAt: tenant.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.isSystemAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = createSchema.parse(await request.json());
  if (body.adminEmail) {
    const existing = await prisma.user.findFirst({
      where: { email: body.adminEmail },
      __allowMissingTenant: true,
    } as Prisma.UserFindFirstArgs & { __allowMissingTenant?: boolean });
    if (existing) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 400 },
      );
    }
  }

  const tenant = await prisma.tenant.create({
    data: { name: body.name },
  });

  if (body.adminEmail) {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        role: "ADMIN",
        email: body.adminEmail,
        passwordHash: null,
      },
    });
  }

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      createdAt: tenant.createdAt.toISOString(),
    },
  });
}
