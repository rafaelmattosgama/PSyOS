import { prisma } from "@/lib/prisma";

export async function getOrCreateEpisode(params: {
  tenantId: string;
  conversationId: string;
  maxTurns?: number;
}) {
  const openEpisode = await prisma.aiEpisode.findFirst({
    where: {
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      isOpen: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (openEpisode) {
    return openEpisode;
  }

  const lastEpisode = await prisma.aiEpisode.findFirst({
    where: {
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    },
    orderBy: { episodeNumber: "desc" },
  });

  const nextEpisodeNumber = (lastEpisode?.episodeNumber ?? 0) + 1;
  return prisma.aiEpisode.create({
    data: {
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      episodeNumber: nextEpisodeNumber,
      aiTurnsUsed: 0,
      isOpen: true,
    },
  });
}
