# PsyOS

Multi-tenant plataforma clinica para psicologos conversarem com pacientes via WhatsApp
Portal web com suporte de IA stateless e politicas clinicas.

## Stack
- Next.js (App Router) + TypeScript strict
- Tailwind v4
- PostgreSQL + Prisma
- Redis + BullMQ
- Email/senha (OTP e passkeys opcionais)

## Setup rapido

1) Instale dependencias:
```bash
pnpm install
```

2) Suba Postgres + Redis locais (Docker):
```bash
docker compose up -d
```

3) Configure variaveis de ambiente:
```bash
cp .env.example .env
```

4) Rode migracoes e gere o cliente Prisma:
```bash
pnpm prisma:migrate
pnpm prisma:generate
```

5) (Opcional) Gere dados iniciais (tenant + usuarios demo):
```bash
pnpm seed
```

6) Suba o app e o worker:
```bash
pnpm dev
pnpm worker
```

Ou em um comando:
```bash
pnpm dev:all
```

## Seed (demo)

Cria um tenant e usuarios com senha padrao.

- Tenant: impresso no console (para referencia)
- Admin: `admin@psyos.local`
- Psicologo: `psicologo@psyos.local`
- Paciente: `paciente@psyos.local`
- System admin: `root@psyos.local`
- Senha: `123456` (ou `SEED_DEFAULT_PASSWORD`)

## Login

- Primeiro passo: informar email.
- Se o usuario existe e ainda nao definiu senha, o sistema pede a criacao.
- Caso contrario, pede a senha e redireciona pelo role.
 - O admin de um tenant pode ser criado pelo root em `/system`.

## Variaveis de ambiente

```
DATABASE_URL=postgresql://psyos:psyos@localhost:5432/psyos
REDIS_URL=redis://localhost:6379
MASTER_KEK_B64=base64_32_bytes

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

WEBAUTHN_RP_NAME=PsyOS
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000

SMTP_URL=smtps://user:pass@smtp.example.com
EMAIL_FROM=psyos@clinic.com
```

## Rotas principais

Paginas:
- `/login`
- `/admin`
- `/app`
- `/patient`
- `/system`

APIs:
- `GET|POST /api/conversations`
- `POST /api/conversations/access-grant`
- `GET /api/messages`
- `POST /api/messages/send`
- `POST /api/records`
- `GET|POST /api/policy`
- `POST /api/auth/webauthn/register`
- `POST /api/auth/webauthn/login`
- `POST /api/auth/otp/request`
- `POST /api/auth/otp/verify`
- `POST /api/auth/password/login`
- `POST /api/auth/password/setup`
- `POST /api/auth/email/check`
- `POST /api/auth/logout`
- `GET|POST /api/admin/psychologists`
- `PATCH /api/admin/psychologists/:id`
- `GET|POST /api/admin/patients`
- `PATCH /api/admin/patients/:id`

## Multitenancy e scoping

- Todas as entidades tem `tenantId`.
- Guardas de tenant no Prisma (`src/lib/prisma.ts`) exigem `tenantId` em toda query
  de modelos sensiveis.
- RBAC: ADMIN, PSYCHOLOGIST, PATIENT.
- Psicologos veem apenas conversas atribuidas.
- Pacientes veem apenas suas conversas.
- Admins precisam de grant explicito para ler mensagens.

## Criptografia

- Cada conversa tem um DEK exclusivo.
- DEK criptografado com `MASTER_KEK_B64` (AES-256-GCM).
- Mensagens armazenadas com `ciphertext`, `iv` e `authTag`.
- Decifragem apenas em runtime para contexto e exibicao.

## IA (stateless)

- Contexto reconstruido a cada request:
  - policy global do tenant
  - policy do psicologo
  - policy da conversa
  - ultimas 20 mensagens
- Sem memoria interna.
- Maximo de 3 turnos por episodio antes de fechamento.
- Detecta ira/discussao, desconexao, ruminacao e risco alto.

## Evolucao WhatsApp

- Idempotencia via `externalMessageId`.
- Jobs:
  - `inbound_message_process`
  - `ai_reply_generate`
  - `outbound_send_retry`

## Estrutura

- Prisma schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`
- Auth e guards: `src/lib/auth/`
- Worker: `src/worker/runner.ts`

## Notas de seguranca

- Rate limit para OTP e senha.
- Lockout por tentativas falhas.
- Step-up exigido para acoes sensiveis (policy global, leitura admin).
- Logs sem dados sensiveis (sem conteudo de mensagens ou OTP).
