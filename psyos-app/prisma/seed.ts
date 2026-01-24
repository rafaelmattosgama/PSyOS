import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth/password";
import { DEFAULT_AIDO_POLICY } from "../src/lib/ai/policy";
import { encryptDek, generateDek, getMasterKek } from "../src/lib/crypto";

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

  await ensureTenantPolicy(tenant.id);

  // eslint-disable-next-line no-console
  console.log("Seed complete");
  // eslint-disable-next-line no-console
  console.log("Tenant:", tenant.id, tenant.name);
  // eslint-disable-next-line no-console
  console.log("Admin:", admin.email);
  // eslint-disable-next-line no-console
  console.log("System admin:", systemAdmin.email);
  // eslint-disable-next-line no-console
  console.log("Psicologo:", psychologist.email);
  // eslint-disable-next-line no-console
  console.log("Paciente:", patient.email);
  // eslint-disable-next-line no-console
  console.log("Senha:", DEFAULT_PASSWORD);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
