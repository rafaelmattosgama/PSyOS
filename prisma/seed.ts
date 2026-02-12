import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth/password";
import { DEFAULT_AIDO_POLICY } from "../src/lib/ai/policy";
import { decryptDek, encryptDek, encryptMessage, generateDek, getMasterKek } from "../src/lib/crypto";

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "123456";
const TENANT_NAME = process.env.SEED_TENANT_NAME ?? "Clinica Aurora";
const SYSTEM_TENANT_NAME = process.env.SEED_SYSTEM_TENANT_NAME ?? "PsyOS System";
const SYSTEM_ADMIN_EMAIL =
  process.env.SEED_SYSTEM_ADMIN_EMAIL ?? "root@psyos.local";

async function ensureTenant() {
  const existing = await prisma.tenant.findFirst({
    where: { name: TENANT_NAME },
  });
  if (existing) {
    return existing;
  }
  return prisma.tenant.create({ data: { name: TENANT_NAME } });
}

async function ensureUser(params: {
  tenantId: string;
  email: string;
  phone?: string;
  role: "ADMIN" | "PSYCHOLOGIST" | "PATIENT";
  isSystemAdmin?: boolean;
}) {
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  return prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: params.tenantId,
        email: params.email,
      },
    },
    update: {
      role: params.role,
      phone: params.phone ?? null,
      isSystemAdmin: params.isSystemAdmin ?? false,
      passwordHash,
    },
    create: {
      tenantId: params.tenantId,
      role: params.role,
      email: params.email,
      phone: params.phone ?? null,
      isSystemAdmin: params.isSystemAdmin ?? false,
      passwordHash,
    },
  });
}

async function ensureProfiles(params: {
  tenantId: string;
  psychologistId: string;
  patientId: string;
  patientPhoneE164: string;
}) {
  await prisma.psychologistProfile.upsert({
    where: { userId: params.psychologistId },
    update: { displayName: "Dra. Carla Nunes" },
    create: { userId: params.psychologistId, displayName: "Dra. Carla Nunes" },
  });

  await prisma.patientProfile.upsert({
    where: { userId: params.patientId },
    update: {
      displayName: "Paciente Demo",
      phoneE164: params.patientPhoneE164,
    },
    create: {
      userId: params.patientId,
      displayName: "Paciente Demo",
      phoneE164: params.patientPhoneE164,
    },
  });
}

async function ensureConversation(params: {
  tenantId: string;
  psychologistId: string;
  patientId: string;
}) {
  const existing = await prisma.conversation.findFirst({
    where: {
      tenantId: params.tenantId,
      psychologistUserId: params.psychologistId,
      patientUserId: params.patientId,
    },
  });

  if (existing) {
    return existing;
  }

  const masterKek = getMasterKek();
  const dek = generateDek();
  const encryptedDek = encryptDek(dek, masterKek);

  return prisma.conversation.create({
    data: {
      tenantId: params.tenantId,
      psychologistUserId: params.psychologistId,
      patientUserId: params.patientId,
      aiEnabled: true,
      encryptedDek,
    },
  });
}

async function seedConversationMessages(params: {
  tenantId: string;
  conversationId: string;
  dek: Buffer;
}) {
  const existing = await prisma.message.findFirst({
    where: { tenantId: params.tenantId, conversationId: params.conversationId },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3600 * 1000);

  const messages = [
    { authorType: "PATIENT", direction: "IN", content: "Hoje acordei com o peito apertado." , createdAt: daysAgo(20)},
    { authorType: "AI", direction: "OUT", content: "Obrigada por contar. O que aconteceu antes disso?" , createdAt: daysAgo(20)},
    { authorType: "PSYCHOLOGIST", direction: "OUT", content: "Vamos registrar isso juntos. Como o corpo reagiu?" , createdAt: daysAgo(20)},
    { authorType: "PATIENT", direction: "IN", content: "Senti um nó no estômago e vontade de chorar." , createdAt: daysAgo(13)},
    { authorType: "AI", direction: "OUT", content: "Quer tentar nomear essa emoção e onde ela aparece no corpo?" , createdAt: daysAgo(13)},
    { authorType: "PATIENT", direction: "IN", content: "Hoje discuti com minha mãe e fiquei irritada." , createdAt: daysAgo(8)},
    { authorType: "PSYCHOLOGIST", direction: "OUT", content: "O que mais te incomodou nessa conversa?" , createdAt: daysAgo(8)},
    { authorType: "PATIENT", direction: "IN", content: "Sinto que ela não me escuta." , createdAt: daysAgo(5)},
    { authorType: "AI", direction: "OUT", content: "O que você gostaria que tivesse sido diferente?" , createdAt: daysAgo(5)},
    { authorType: "PATIENT", direction: "IN", content: "Hoje foi um dia melhor, consegui descansar um pouco." , createdAt: daysAgo(2)},
  ];

  const data = messages.map((message) => {
    const encrypted = encryptMessage(message.content, params.dek);
    return {
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      direction: message.direction as "IN" | "OUT",
      authorType: message.authorType as "PATIENT" | "PSYCHOLOGIST" | "AI",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      createdAt: message.createdAt,
    };
  });

  await prisma.message.createMany({ data });
}

async function seedConversationRecords(params: {
  tenantId: string;
  conversationId: string;
  createdByUserId: string;
}) {
  const existing = await prisma.record.findFirst({
    where: { tenantId: params.tenantId, conversationId: params.conversationId },
    select: { id: true },
  });
  if (existing) {
    return;
  }
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3600 * 1000);

  await prisma.record.createMany({
    data: [
      {
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        createdByUserId: params.createdByUserId,
        dataJson: {
          event: "Discussão com a mãe",
          thought: "Ela nunca me entende",
          emotion: "irritada",
          body: "peito apertado",
          action: "saí do quarto",
          result: "alívio curto",
        },
        createdAt: daysAgo(8),
      },
      {
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        createdByUserId: params.createdByUserId,
        dataJson: {
          event: "Dia com pouca energia",
          thought: "Não vou dar conta",
          emotion: "cansada",
          body: "peso nos ombros",
          action: "descansar",
          result: "melhora leve",
        },
        createdAt: daysAgo(13),
      },
      {
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        createdByUserId: params.createdByUserId,
        dataJson: {
          event: "Dia melhor",
          thought: "Posso me cuidar",
          emotion: "alívio",
          body: "respiração mais leve",
          action: "caminhada curta",
          result: "mais calma",
        },
        createdAt: daysAgo(2),
      },
    ],
  });
}

async function ensureTenantPolicy(tenantId: string) {
  const existing = await prisma.aiPolicy.findFirst({
    where: { tenantId, ownerUserId: null, conversationId: null },
  });
  if (existing) {
    return existing;
  }
  return prisma.aiPolicy.create({
    data: {
      tenantId,
      policyText: DEFAULT_AIDO_POLICY,
    },
  });
}

async function main() {
  if (!process.env.MASTER_KEK_B64) {
    throw new Error("MASTER_KEK_B64 must be set before seeding.");
  }

  const tenant = await ensureTenant();
  const existingSystemTenant = await prisma.tenant.findFirst({
    where: { name: SYSTEM_TENANT_NAME },
  });
  const systemTenant =
    existingSystemTenant ??
    (await prisma.tenant.create({
      data: { name: SYSTEM_TENANT_NAME },
    }));
  const patientPhone = "5511999999999";

  const admin = await ensureUser({
    tenantId: tenant.id,
    role: "ADMIN",
    email: "admin@psyos.local",
  });
  const systemAdmin = await ensureUser({
    tenantId: systemTenant.id,
    role: "ADMIN",
    email: SYSTEM_ADMIN_EMAIL,
    isSystemAdmin: true,
  });
  const psychologist = await ensureUser({
    tenantId: tenant.id,
    role: "PSYCHOLOGIST",
    email: "psicologo@psyos.local",
  });
  const patient = await ensureUser({
    tenantId: tenant.id,
    role: "PATIENT",
    email: "paciente@psyos.local",
    phone: patientPhone,
  });

  await ensureProfiles({
    tenantId: tenant.id,
    psychologistId: psychologist.id,
    patientId: patient.id,
    patientPhoneE164: patientPhone,
  });

  await ensureConversation({
    tenantId: tenant.id,
    psychologistId: psychologist.id,
    patientId: patient.id,
  });
  const conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: tenant.id,
      psychologistUserId: psychologist.id,
      patientUserId: patient.id,
    },
  });

  if (conversation) {
    const dek = decryptDek(conversation.encryptedDek, getMasterKek());
    await seedConversationMessages({
      tenantId: tenant.id,
      conversationId: conversation.id,
      dek,
    });
    await seedConversationRecords({
      tenantId: tenant.id,
      conversationId: conversation.id,
      createdByUserId: psychologist.id,
    });
  }

  await ensureTenantPolicy(tenant.id);

  console.log("Seed complete");
  console.log("Tenant:", tenant.id, tenant.name);
  console.log("Admin:", admin.email);
  console.log("System admin:", systemAdmin.email);
  console.log("Psicologo:", psychologist.email);
  console.log("Paciente:", patient.email);
  console.log("Senha:", DEFAULT_PASSWORD);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
