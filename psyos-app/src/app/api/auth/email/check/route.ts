import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const user = await prisma.user.findFirst({
    where: { email: body.email },
    __allowMissingTenant: true,
  } as Prisma.UserFindFirstArgs & { __allowMissingTenant?: boolean });

  if (!user) {
    return NextResponse.json({ status: "not_found" });
  }

  if (!user.isActive) {
    return NextResponse.json({ status: "not_found" });
  }

  if (!user.passwordHash) {
    return NextResponse.json({ status: "setup" });
  }

  return NextResponse.json({ status: "login" });
}
