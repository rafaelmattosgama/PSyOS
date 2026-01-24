"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SIGNAL_CONFIG,
  detectSignals,
  resolveSignalConfig,
  type SignalConfig,
  type SignalKey,
} from "@/lib/ai/detection";

type ConversationItem = {
  id: string;
  aiEnabled: boolean;
  updatedAt: string;
  patient: {
    id: string;
    email: string | null;
    patientProfile?: { displayName?: string | null } | null;
  };
};

type MessageItem = {
  id: string;
  authorType: "PATIENT" | "PSYCHOLOGIST" | "AI" | "SYSTEM";
  content: string;
  createdAt: string;
};

type PolicyResponse = {
  item?: { policyText?: string | null; flagsJson?: Record<string, unknown> | null };
};

type EpisodeResponse = {
  item?: { aiTurnsUsed?: number | null; isOpen?: boolean | null };
};

type PromptResponse = {
  item?: {
    createdAt: string;
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  } | null;
};

type Props = {
  tenantId: string;
};

const POLICY_SUGGESTIONS = [
  {
    id: "focus-record",
    label: "Foco em registro",
    text: "Priorizar registro do evento, pensamentos, emocao e acao. Evitar interpretacoes.",
  },
  {
    id: "micro-actions",
    label: "Micro-acoes",
    text: "Sempre oferecer 1-2 micro-acoes concretas e realistas.",
  },
  {
    id: "rumination",
    label: "Ruminacao",
    text: "Se houver ruminacao, redirecionar para observacao e acao sem interpretacao.",
  },
  {
    id: "anger-rain",
    label: "Ira/Discussao (RAIN)",
    text: "Se ira/discussao, aplicar RAIN com foco em reconhecer e nao se identificar.",
  },
  {
    id: "disconnect",
    label: "Desconexao",
    text: "Se desconexao, ancorar no corpo e nomear sensacoes sem pressao.",
  },
  {
    id: "safety",
    label: "Seguranca",
    text: "Se risco alto, orientar contato com terapeuta/emergencias. Nao substituir sessao.",
  },
  {
    id: "tone-brief",
    label: "Tom breve",
    text: "Tom claro, breve e profissional. Perguntar, nao interpretar.",
  },
  {
    id: "closure",
    label: "Fechamento curto",
    text: "Encerrar episodio em ate 3 trocas e propor fechamento breve.",
  },
];

const DEMO_CONVERSATION_ID = "__demo__";
const demoConversation: ConversationItem = {
  id: DEMO_CONVERSATION_ID,
  aiEnabled: true,
  updatedAt: new Date().toISOString(),
  patient: {
    id: "demo-patient",
    email: "paciente.demo@psyos.local",
    patientProfile: { displayName: "Paciente demo" },
  },
};

const demoMessages: MessageItem[] = [
  {
    id: "demo-1",
    authorType: "PATIENT",
    content: "Hoje acordei com o peito apertado e fiquei sem energia.",
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo-2",
    authorType: "AI",
    content:
      "Obrigada por contar. O que aconteceu imediatamente antes disso? Onde voce sentiu no corpo?",
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo-3",
    authorType: "PSYCHOLOGIST",
    content: "Vamos registrar com calma. O que voce fez para se cuidar depois?",
    createdAt: new Date().toISOString(),
  },
];

async function getJson<T>(url: string) {
  const response = await fetch(url, { method: "GET" });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}

async function sendJson<T>(
  url: string,
  payload: Record<string, unknown>,
  method: "POST" | "PATCH" = "POST",
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}

export default function PsychologistClient({ tenantId }: Props) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const [messageDraft, setMessageDraft] = useState("");
  const [psychPolicy, setPsychPolicy] = useState("");
  const [conversationPolicy, setConversationPolicy] = useState("");
  const [showConversationPolicy, setShowConversationPolicy] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [aiTurnsUsed, setAiTurnsUsed] = useState<number | null>(null);
  const [episodeOpen, setEpisodeOpen] = useState<boolean | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [policySelections, setPolicySelections] = useState<string[]>([]);
  const [policyObjective, setPolicyObjective] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptSnapshot, setPromptSnapshot] = useState<PromptResponse["item"]>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [showPsychPolicy, setShowPsychPolicy] = useState(false);
  const [psychPolicyTab, setPsychPolicyTab] = useState<
    "policy" | "context" | "signals"
  >("policy");
  const [signalConfig, setSignalConfig] = useState<SignalConfig>(
    resolveSignalConfig(DEFAULT_SIGNAL_CONFIG),
  );
  const [aiMaxTokens, setAiMaxTokens] = useState(300);
  const [aiMaxTurns, setAiMaxTurns] = useState(3);
  const [aiTemperature, setAiTemperature] = useState(0.4);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAi, setFilterAi] = useState<"all" | "enabled" | "disabled">("all");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");

  const [recordEvent, setRecordEvent] = useState("");
  const [recordThought, setRecordThought] = useState("");
  const [recordEmotion, setRecordEmotion] = useState("");
  const [recordBody, setRecordBody] = useState("");
  const [recordAction, setRecordAction] = useState("");
  const [recordResult, setRecordResult] = useState("");

  const selectedConversation = useMemo(
    () => conversations.find((conv) => conv.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let items = conversations;
    if (term) {
      items = items.filter((conv) => {
        const name =
          conv.patient.patientProfile?.displayName ??
          conv.patient.email ??
          "Paciente";
        return name.toLowerCase().includes(term);
      });
    }
    if (filterAi !== "all") {
      items = items.filter((conv) =>
        filterAi === "enabled" ? conv.aiEnabled : !conv.aiEnabled,
      );
    }
    if (sortBy === "name") {
      items = [...items].sort((a, b) => {
        const nameA =
          a.patient.patientProfile?.displayName ?? a.patient.email ?? "Paciente";
        const nameB =
          b.patient.patientProfile?.displayName ?? b.patient.email ?? "Paciente";
        return nameA.localeCompare(nameB);
      });
    } else {
      items = [...items].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }
    return items;
  }, [conversations, searchTerm, filterAi, sortBy]);

  const loadConversations = async () => {
    setLoading(true);
    try {
      const data = await getJson<{ items: ConversationItem[] }>(
        "/api/conversations",
      );
      const items = data.items ?? [];
      if (items.length === 0) {
        setConversations([demoConversation]);
        setSelectedId(DEMO_CONVERSATION_ID);
        setMessages(demoMessages);
      } else {
        setConversations(items);
        if (!selectedId || selectedId === DEMO_CONVERSATION_ID) {
          setSelectedId(items[0].id);
        }
      }
      setStatus("");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (
    conversationId: string,
    options?: { silent?: boolean },
  ) => {
    if (conversationId === DEMO_CONVERSATION_ID) {
      setMessages(demoMessages);
      return;
    }
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const data = await getJson<{ items: MessageItem[] }>(
        `/api/messages?conversationId=${conversationId}`,
      );
      setMessages(data.items ?? []);
      setStatus("");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  };

  const loadPolicies = async (conversationId: string) => {
    if (conversationId === DEMO_CONVERSATION_ID) {
      setPsychPolicy(
        "Acompanhar entre sessoes, incentivar registro de eventos e observacao de sinais corporais.",
      );
      setConversationPolicy(
        "Foco em registrar o que aconteceu hoje e identificar pequenas acoes de cuidado.",
      );
      setSignalConfig(resolveSignalConfig(DEFAULT_SIGNAL_CONFIG));
      setAiMaxTokens(300);
      setAiMaxTurns(3);
      setAiTemperature(0.4);
      setPolicySelections(["focus-record", "micro-actions"]);
      setPolicyObjective("Manter o paciente ancorado no corpo hoje.");
      return;
    }
    try {
      const [psych, convo] = await Promise.all([
        getJson<PolicyResponse>("/api/policy?scope=user"),
        getJson<PolicyResponse>(
          `/api/policy?scope=conversation&conversationId=${conversationId}`,
        ),
      ]);
      setPsychPolicy(psych.item?.policyText ?? "");
      setConversationPolicy(convo.item?.policyText ?? "");
      const psychFlags = psych.item?.flagsJson ?? null;
      const config = resolveSignalConfig(
        (psychFlags as { signalConfig?: unknown })?.signalConfig as
          | Partial<SignalConfig>
          | undefined,
      );
      setSignalConfig(config);
      const settings = (psychFlags as { aiSettings?: unknown })?.aiSettings as
        | { maxTokens?: number; maxTurns?: number; temperature?: number }
        | undefined;
      setAiMaxTokens(settings?.maxTokens ?? 300);
      setAiMaxTurns(settings?.maxTurns ?? 3);
      setAiTemperature(settings?.temperature ?? 0.4);
      const flags = convo.item?.flagsJson ?? null;
      const presetIds = Array.isArray((flags as { presetIds?: unknown })?.presetIds)
        ? ((flags as { presetIds?: unknown }).presetIds as string[])
        : [];
      const objective =
        typeof (flags as { objective?: unknown })?.objective === "string"
          ? ((flags as { objective?: unknown }).objective as string)
          : "";
      setPolicySelections(presetIds);
      setPolicyObjective(objective);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const loadEpisode = async (conversationId: string) => {
    if (conversationId === DEMO_CONVERSATION_ID) {
      setAiTurnsUsed(1);
      setEpisodeOpen(true);
      return;
    }
    try {
      const data = await getJson<EpisodeResponse>(
        `/api/ai/episode?conversationId=${conversationId}`,
      );
      setAiTurnsUsed(data.item?.aiTurnsUsed ?? 0);
      setEpisodeOpen(Boolean(data.item?.isOpen));
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const handleSelectConversation = async (conversationId: string) => {
    setSelectedId(conversationId);
    setShowConversationPolicy(false);
    setShowRecord(false);
    shouldAutoScrollRef.current = true;
    setShowScrollToBottom(false);
    setIsMobileMenuOpen(false);
    setShowPrompt(false);
    setShowPsychPolicy(false);
    await Promise.all([
      loadMessages(conversationId),
      loadPolicies(conversationId),
      loadEpisode(conversationId),
    ]);
  };

  const handleSendMessage = async () => {
    if (!selectedId || !messageDraft.trim()) {
      return;
    }
    if (selectedId === DEMO_CONVERSATION_ID) {
      setStatus("Conversa de demonstracao: envio desativado.");
      return;
    }
    try {
      setLoading(true);
      await sendJson("/api/messages/send", {
        tenantId,
        conversationId: selectedId,
        content: messageDraft.trim(),
      });
      setMessageDraft("");
      await Promise.all([loadMessages(selectedId), loadEpisode(selectedId)]);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePolicy = async (scope: "user" | "conversation") => {
    if (scope === "conversation" && !selectedId) {
      return;
    }
    if (selectedId === DEMO_CONVERSATION_ID) {
      setStatus("Conversa de demonstracao: alteracoes desativadas.");
      return;
    }
    try {
      setLoading(true);
      await sendJson("/api/policy", {
        tenantId,
        scope,
        conversationId: scope === "conversation" ? selectedId : undefined,
        policyText:
          scope === "conversation" ? conversationPolicy.trim() : psychPolicy.trim(),
        flagsJson:
          scope === "conversation"
            ? {
                presetIds: policySelections,
                objective: policyObjective.trim() || null,
              }
            : scope === "user"
              ? {
                  signalConfig,
                  aiSettings: {
                    maxTokens: aiMaxTokens,
                    maxTurns: aiMaxTurns,
                    temperature: aiTemperature,
                  },
                }
              : undefined,
      });
      setStatus("Policy salva.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAi = async () => {
    if (!selectedId || selectedId === DEMO_CONVERSATION_ID) {
      setStatus("Conversa de demonstracao: alteracao desativada.");
      return;
    }
    try {
      setLoading(true);
      const nextValue = !selectedConversation?.aiEnabled;
      const response = await sendJson<{ item: { aiEnabled: boolean } }>(
        "/api/conversations",
        { conversationId: selectedId, aiEnabled: nextValue },
        "PATCH",
      );
      setConversations((current) =>
        current.map((item) =>
          item.id === selectedId ? { ...item, aiEnabled: response.item.aiEnabled } : item,
        ),
      );
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRecord = async () => {
    if (!selectedId || !recordEvent.trim()) {
      setStatus("Informe o evento antes de salvar.");
      return;
    }
    if (selectedId === DEMO_CONVERSATION_ID) {
      setStatus("Conversa de demonstracao: registro desativado.");
      return;
    }
    try {
      setLoading(true);
      await sendJson("/api/records", {
        tenantId,
        conversationId: selectedId,
        event: recordEvent.trim(),
        thought: recordThought.trim(),
        emotion: recordEmotion.trim(),
        body: recordBody.trim(),
        action: recordAction.trim(),
        result: recordResult.trim(),
      });
      setRecordEvent("");
      setRecordThought("");
      setRecordEmotion("");
      setRecordBody("");
      setRecordAction("");
      setRecordResult("");
      setStatus("Registro salvo.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPsychPolicy = () => {
    setShowPsychPolicy(true);
    setIsMobileMenuOpen(false);
    setPsychPolicyTab("policy");
  };

  const lastPatientMessage = useMemo(() => {
    return [...messages].reverse().find((message) => message.authorType === "PATIENT");
  }, [messages]);

  const localSignals = useMemo(
    () => detectSignals(lastPatientMessage?.content ?? "", signalConfig),
    [lastPatientMessage?.content, signalConfig],
  );

  const contextPreview = useMemo(() => {
    return messages.slice(-20).map((message) => {
      const label =
        message.authorType === "PSYCHOLOGIST"
          ? "Psicologo"
          : message.authorType === "PATIENT"
            ? "Paciente"
            : message.authorType;
      return `[${label}] ${message.content}`;
    });
  }, [messages]);

  const handleOpenPrompt = async () => {
    if (!selectedId) {
      return;
    }
    setPromptLoading(true);
    const policyBlocks = [psychPolicy, conversationPolicy]
      .map((text) => text.trim())
      .filter(Boolean);
    const extraDirectives = [
      localSignals.anger ? signalConfig.anger.directive : "",
      localSignals.disconnect ? signalConfig.disconnect.directive : "",
      localSignals.rumination ? signalConfig.rumination.directive : "",
      localSignals.highRisk ? signalConfig.highRisk.directive : "",
      "Nunca exponha dados de outros pacientes ou tenants.",
    ]
      .filter(Boolean)
      .join(" ");
    const systemContent = [policyBlocks.join("\n\n"), extraDirectives]
      .filter(Boolean)
      .join("\n\n");
    const contextMessages = messages.slice(-20).map((message) => {
      if (message.authorType === "PATIENT") {
        return { role: "user" as const, content: message.content };
      }
      if (message.authorType === "PSYCHOLOGIST") {
        return {
          role: "assistant" as const,
          content: `Psicologo: ${message.content}`,
        };
      }
      return { role: "assistant" as const, content: message.content };
    });
    setPromptSnapshot({
      createdAt: new Date().toISOString(),
      model: "preview",
      messages: [{ role: "system", content: systemContent }, ...contextMessages],
    });
    setShowPrompt(true);
    setPromptLoading(false);
  };

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadMessages(selectedId);
      loadPolicies(selectedId);
      setShowConversationPolicy(false);
      setShowRecord(false);
      shouldAutoScrollRef.current = true;
      setShowScrollToBottom(false);
      setShowPsychPolicy(false);
      loadEpisode(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || selectedId === DEMO_CONVERSATION_ID) {
      return;
    }
    const interval = setInterval(() => {
      loadMessages(selectedId, { silent: true });
      loadEpisode(selectedId);
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container || !shouldAutoScrollRef.current) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  const handleMessageScroll = () => {
    const container = messageListRef.current;
    if (!container) {
      return;
    }
    const threshold = 40;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      threshold;
    shouldAutoScrollRef.current = isNearBottom;
    setShowScrollToBottom(!isNearBottom);
  };

  const asideContent = (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
              Politica do psicologo
            </p>
            <p className="mt-2 text-sm text-[color:var(--ink-900)]">
              Defina tom e limites pessoais para todas as conversas.
            </p>
          </div>
          <button
            className="rounded-full border border-black/10 px-3 py-2 text-xs font-semibold text-[color:var(--ink-900)]"
            type="button"
            onClick={handleOpenPsychPolicy}
          >
            Editar
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl text-[color:var(--ink-900)]">Conversas</h1>
          <span className="rounded-full border border-black/10 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--ink-500)]">
            {filteredConversations.length}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--ink-500)]">
  <svg
    aria-hidden="true"
    viewBox="0 0 20 20"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <circle cx="9" cy="9" r="6" />
    <path d="M14 14l4 4" />
  </svg>
</span>
            <input
              className="h-10 w-full rounded-xl border border-black/10 bg-white/90 pl-8 pr-3 text-sm"
              placeholder="Buscar paciente..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-[color:var(--ink-500)]">
            <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-3 py-1">
              <span>IA</span>
              <select
                className="bg-transparent text-[11px]"
                value={filterAi}
                onChange={(event) =>
                  setFilterAi(event.target.value as "all" | "enabled" | "disabled")
                }
              >
                <option value="all">todos</option>
                <option value="enabled">ligada</option>
                <option value="disabled">desligada</option>
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-3 py-1">
              <span>Ordenar</span>
              <select
                className="bg-transparent text-[11px]"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as "recent" | "name")}
              >
                <option value="recent">recentes</option>
                <option value="name">nome</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-6 flex-1 min-h-0 space-y-3 overflow-y-auto px-2 pb-2 pt-1">
          {filteredConversations.map((conv) => {
            const name =
              conv.patient.patientProfile?.displayName ??
              conv.patient.email ??
              "Paciente";
            return (
              <button
                key={conv.id}
                type="button"
                className={`w-full rounded-2xl border px-4 py-3 text-left ${
                  conv.id === selectedId
                    ? "border-[color:var(--accent-500)] bg-white shadow-[0_12px_26px_var(--shadow-color)]"
                    : "border-black/10 bg-[color:var(--surface-100)]"
                }`}
                onClick={() => handleSelectConversation(conv.id)}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-[color:var(--ink-900)]">
                    {name}
                  </p>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      conv.aiEnabled
                        ? "bg-[color:var(--accent-500)]"
                        : "bg-[color:var(--ink-500)]"
                    }`}
                  />
                </div>
                <p className="mt-2 text-xs text-[color:var(--ink-500)]">
                  {new Date(conv.updatedAt).toLocaleString()}
                </p>
              </button>
            );
          })}
          {filteredConversations.length === 0 ? (
            <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-500)]">
              Nenhuma conversa encontrada.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  const scrollToBottom = () => {
    const container = messageListRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
    shouldAutoScrollRef.current = true;
    setShowScrollToBottom(false);
  };

  const togglePolicySelection = (id: string) => {
    setPolicySelections((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const buildPolicyDraft = () => {
    const bullets = POLICY_SUGGESTIONS.filter((item) =>
      policySelections.includes(item.id),
    )
      .map((item) => `- ${item.text}`)
      .concat(
        policyObjective.trim()
          ? [`- Objetivo do momento: ${policyObjective.trim()}`]
          : [],
      );
    return bullets.join("\n");
  };

  const applyPolicyDraft = (mode: "replace" | "append") => {
    const draft = buildPolicyDraft();
    if (!draft) {
      setStatus("Selecione ao menos uma sugestao.");
      return;
    }
    if (mode === "replace") {
      setConversationPolicy(draft);
    } else {
      setConversationPolicy((current) =>
        current.trim() ? `${current.trim()}\n\n${draft}` : draft,
      );
    }
    setStatus("Rascunho aplicado. Revise antes de salvar.");
  };

  const updateSignalKeywords = (key: SignalKey, value: string) => {
    const parsed = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    setSignalConfig((current) => ({
      ...current,
      [key]: {
        ...current[key],
        keywords: parsed,
      },
    }));
  };

  const updateSignalDirective = (key: SignalKey, value: string) => {
    setSignalConfig((current) => ({
      ...current,
      [key]: {
        ...current[key],
        directive: value,
      },
    }));
  };

  const resetAiSettings = () => {
    setAiMaxTokens(300);
    setAiMaxTurns(3);
    setAiTemperature(0.4);
  };

  const adjustTextareaHeight = (element: HTMLTextAreaElement | null) => {
    if (!element) {
      return;
    }
    const maxHeight = 240;
    element.style.height = "auto";
    const nextHeight = Math.min(element.scrollHeight, maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  useEffect(() => {
    adjustTextareaHeight(messageInputRef.current);
  }, [messageDraft]);

  return (
    <div className="mx-auto grid w-full gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="hidden lg:flex lg:h-[calc(100vh-48px)] lg:min-h-0 lg:flex-col lg:gap-6 lg:overflow-hidden">
        {asideContent}
      </aside>

      {isMobileMenuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="Fechar menu"
          />
          <div className="absolute left-0 top-0 h-full w-[88%] max-w-sm overflow-y-auto bg-[color:var(--surface-100)] p-5 shadow-[0_18px_40px_var(--shadow-color)]">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
                Menu
              </p>
              <button
                type="button"
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Fechar
              </button>
            </div>
            {asideContent}
          </div>
        </div>
      ) : null}

      <section className="flex min-h-0 flex-col gap-6 lg:h-[calc(100vh-48px)]">
        <div className="flex h-[calc(100svh-96px)] flex-1 flex-col overflow-hidden rounded-[28px] border border-black/10 bg-white/85 p-6 shadow-[0_18px_40px_var(--shadow-color)] lg:h-full">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
                Conversa ativa
              </p>
              <h2 className="text-2xl text-[color:var(--ink-900)]">
                {selectedConversation
                  ? selectedConversation.patient.patientProfile?.displayName ??
                    selectedConversation.patient.email ??
                    "Paciente"
                  : "Selecione uma conversa"}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)] lg:hidden"
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
              >
                Menu
              </button>
              <span className="text-xs text-[color:var(--ink-500)]">
                {selectedConversation?.aiEnabled ? "IA habilitada" : "IA desativada"}
              </span>
              <span className="text-xs text-[color:var(--ink-500)]">
                Episodio:{" "}
                {aiTurnsUsed === null ? "-" : `${aiTurnsUsed}/3`}
                {episodeOpen === false ? " (fechado)" : ""}
              </span>
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                type="button"
                onClick={handleToggleAi}
                disabled={!selectedId || selectedId === DEMO_CONVERSATION_ID}
              >
                {selectedConversation?.aiEnabled ? "Desligar IA" : "Ligar IA"}
              </button>
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                type="button"
                onClick={() => setShowConversationPolicy((current) => !current)}
                disabled={!selectedId}
              >
                Politica da conversa
              </button>
              <button
                className="rounded-full bg-[color:var(--accent-500)] px-3 py-1 text-xs font-semibold text-white"
                type="button"
                onClick={() => setShowRecord((current) => !current)}
                disabled={!selectedId}
              >
                Salvar registro
              </button>
            </div>
          </div>

          {showConversationPolicy ? (
            <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 p-4">
              <h3 className="text-sm font-semibold text-[color:var(--ink-900)]">
                Politica da conversa
              </h3>
              <div className="mt-3 rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4">
                <p className="text-xs font-semibold text-[color:var(--ink-900)]">
                  Assistente de politica
                </p>
                <p className="mt-1 text-xs text-[color:var(--ink-500)]">
                  Selecione diretrizes para gerar um rascunho base.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {POLICY_SUGGESTIONS.map((item) => {
                    const active = policySelections.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => togglePolicySelection(item.id)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                          active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-black/10 bg-white text-[color:var(--ink-900)]"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                  onClick={() => applyPolicyDraft("replace")}
                >
                  Gerar rascunho
                </button>
                <button
                  type="button"
                  className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                  onClick={() => applyPolicyDraft("append")}
                >
                  Adicionar ao texto
                </button>
                  <button
                    type="button"
                    className="text-xs text-[color:var(--ink-500)]"
                    onClick={() => {
                      setPolicySelections([]);
                      setPolicyObjective("");
                    }}
                  >
                    Limpar selecao
                  </button>
              </div>
              <div className="mt-4">
                <label className="text-xs font-semibold text-[color:var(--ink-900)]">
                  Objetivo do momento
                </label>
                <input
                  className="mt-2 h-10 w-full rounded-xl border border-black/10 bg-white/90 px-3 text-sm"
                  placeholder="Ex: reduzir ruminacao esta semana com pequenas acoes diarias"
                  value={policyObjective}
                  onChange={(event) => setPolicyObjective(event.target.value)}
                />
              </div>
              </div>
              <textarea
                className="mt-3 min-h-[140px] w-full rounded-2xl border border-black/10 bg-white/90 p-4 text-sm"
                value={conversationPolicy}
                onChange={(event) => setConversationPolicy(event.target.value)}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  className="h-9 rounded-xl border border-black/10 px-4 text-xs font-semibold text-[color:var(--ink-900)]"
                  type="button"
                  onClick={() => handleSavePolicy("conversation")}
                  disabled={!selectedId}
                >
                  Salvar policy da conversa
                </button>
                <button
                  className="text-xs text-[color:var(--ink-500)]"
                  type="button"
                  onClick={() => setShowConversationPolicy(false)}
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : null}

          {showRecord ? (
            <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[color:var(--ink-900)]">
                  Salvar registro
                </h3>
                <button
                  className="text-xs text-[color:var(--ink-500)]"
                  type="button"
                  onClick={() => setShowRecord(false)}
                >
                  Fechar
                </button>
              </div>
              <p className="mt-2 text-xs text-[color:var(--ink-500)]">
                Evento -&gt; pensamento/emocao -&gt; sensacao corporal -&gt; acao -&gt; resultado.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder="Evento"
                  value={recordEvent}
                  onChange={(event) => setRecordEvent(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder="Pensamento"
                  value={recordThought}
                  onChange={(event) => setRecordThought(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder="Emocao"
                  value={recordEmotion}
                  onChange={(event) => setRecordEmotion(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder="Sensacao corporal"
                  value={recordBody}
                  onChange={(event) => setRecordBody(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder="Acao"
                  value={recordAction}
                  onChange={(event) => setRecordAction(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder="Resultado"
                  value={recordResult}
                  onChange={(event) => setRecordResult(event.target.value)}
                />
              </div>
              <button
                className="mt-4 h-11 rounded-xl bg-[color:var(--accent-500)] px-5 text-sm font-semibold text-white"
                type="button"
                onClick={handleSaveRecord}
                disabled={!selectedId}
              >
                Salvar registro
              </button>
            </div>
          ) : null}

          <div className="relative mt-6 flex-1 min-h-0">
            <div
              ref={messageListRef}
              onScroll={handleMessageScroll}
            className="h-full space-y-4 overflow-y-auto px-2 pb-2 pt-1"
            >
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.authorType === "PSYCHOLOGIST"
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <div
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-[0_14px_30px_var(--shadow-color)] ring-1 ring-black/5 ${
                    message.authorType === "PSYCHOLOGIST"
                      ? "bg-[color:var(--accent-500)] text-white"
                      : message.authorType === "AI"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-900 ring-emerald-200/60"
                        : "bg-[color:var(--surface-100)] text-[color:var(--ink-900)]"
                  }`}
                >
                    <p className="text-xs uppercase tracking-[0.2em] opacity-70">
                      {message.authorType}
                    </p>
                    <p className="mt-2">{message.content}</p>
                  </div>
                </div>
              ))}
            </div>
            {showScrollToBottom ? (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-3 right-2 rounded-full border border-black/10 bg-white/90 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)] shadow-[0_8px_18px_var(--shadow-color)]"
              >
                Ir para o fim
              </button>
            ) : null}
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-black/10 pt-4 sm:flex-row">
            <textarea
              ref={messageInputRef}
              className="min-h-[96px] max-h-[240px] flex-1 resize-none rounded-xl border border-black/10 bg-white/90 px-4 py-3 text-sm"
              placeholder="Escreva uma resposta..."
              value={messageDraft}
              onChange={(event) => {
                setMessageDraft(event.target.value);
                adjustTextareaHeight(event.currentTarget);
              }}
            />
            <button
              className="h-12 rounded-xl bg-[color:var(--accent-500)] px-6 text-sm font-semibold text-white sm:self-end"
              type="button"
              onClick={handleSendMessage}
              disabled={loading || !selectedId || selectedId === DEMO_CONVERSATION_ID}
            >
              Enviar
            </button>
          </div>
        </div>

        {status ? (
          <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] px-4 py-3 text-xs text-[color:var(--ink-500)]">
            {loading ? "Carregando..." : status}
          </div>
        ) : null}
      </section>

      {showPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-3xl rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_18px_40px_var(--shadow-color)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                  Prompt da IA (preview)
                </p>
                <p className="text-sm text-[color:var(--ink-900)]">
                  {promptSnapshot?.model ?? "preview"} ·{" "}
                  {promptSnapshot?.createdAt
                    ? new Date(promptSnapshot.createdAt).toLocaleString()
                    : "sem timestamp"}
                </p>
              </div>
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                type="button"
                onClick={() => setShowPrompt(false)}
              >
                Fechar
              </button>
            </div>
            {promptSnapshot ? (
              <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-900)]">
                <pre className="whitespace-pre-wrap">
                  {promptSnapshot.messages
                    .map((message) => `[${message.role}] ${message.content}`)
                    .join("\n\n")}
                </pre>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-500)]">
                Nenhum prompt encontrado para esta conversa ainda.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {showPsychPolicy ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="flex w-full max-w-2xl flex-col rounded-[28px] border border-black/10 bg-white shadow-[0_18px_40px_var(--shadow-color)]">
            <div className="flex items-center justify-between border-b border-black/10 px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                  Politica do psicologo
                </p>
                <p className="text-sm text-[color:var(--ink-900)]">
                  Esta politica se aplica a todas as conversas.
                </p>
              </div>
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                type="button"
                onClick={() => setShowPsychPolicy(false)}
              >
                Fechar
              </button>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-black/10 px-6 py-3">
              {[
                { id: "policy", label: "Policy" },
                { id: "context", label: "Contexto" },
                { id: "signals", label: "Sinais" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    psychPolicyTab === tab.id
                      ? "border-[color:var(--accent-500)] bg-[color:var(--accent-500)] text-white"
                      : "border-black/10 bg-white text-[color:var(--ink-900)]"
                  }`}
                  onClick={() =>
                    setPsychPolicyTab(tab.id as "policy" | "context" | "signals")
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="max-h-[85vh] flex-1 overflow-y-auto px-6 py-5">
            {psychPolicyTab === "policy" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-500)]">
                  <p className="font-semibold text-[color:var(--ink-900)]">
                    Estrutura do prompt (system)
                  </p>
                  <div className="mt-2 space-y-1">
                    <p>1) Policy do psicologo (editavel)</p>
                    <p>2) Policy da conversa (editavel no chat ativo)</p>
                    <p>3) Diretivas automaticas (sinais e seguranca)</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-semibold text-[color:var(--ink-900)]">
                    Policy do psicologo (editavel)
                  </label>
                  <textarea
                    className="min-h-[160px] w-full rounded-2xl border border-black/10 bg-white/90 p-4 text-sm"
                    value={psychPolicy}
                    onChange={(event) => setPsychPolicy(event.target.value)}
                  />
                  <div className="rounded-2xl border border-black/10 bg-white/90 p-4 text-xs text-[color:var(--ink-900)]">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                      Ajustes da IA (por psicologo)
                    </p>
                    <div className="mt-3 grid gap-4">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-[color:var(--ink-500)]">
                          <span>Max tokens</span>
                          <span>{aiMaxTokens}</span>
                        </div>
                        <input
                          type="range"
                          min={100}
                          max={1000}
                          step={50}
                          value={aiMaxTokens}
                          onChange={(event) =>
                            setAiMaxTokens(Number(event.target.value))
                          }
                          className="mt-2 w-full"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-[11px] text-[color:var(--ink-500)]">
                          Max turns por episodio
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={aiMaxTurns}
                          onChange={(event) =>
                            setAiMaxTurns(
                              Math.max(1, Math.min(10, Number(event.target.value))),
                            )
                          }
                          className="h-9 w-20 rounded-lg border border-black/10 bg-white/90 px-2 text-xs"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-[color:var(--ink-500)]">
                          <span>Temperatura</span>
                          <span>{aiTemperature.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={aiTemperature}
                          onChange={(event) =>
                            setAiTemperature(Number(event.target.value))
                          }
                          className="mt-2 w-full"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-[color:var(--ink-500)]">
                          Restaurar padrao
                        </span>
                        <button
                          type="button"
                          onClick={resetAiSettings}
                          className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-semibold text-[color:var(--ink-900)]"
                        >
                          Resetar
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="h-10 rounded-xl bg-[color:var(--accent-500)] px-4 text-xs font-semibold text-white"
                      type="button"
                      onClick={() => handleSavePolicy("user")}
                      disabled={loading}
                    >
                      Salvar policy do psicologo
                    </button>
                    <span className="text-xs text-[color:var(--ink-500)]">
                      {loading ? "Salvando..." : "Revisar antes de salvar."}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-500)]">
                  <p className="font-semibold text-[color:var(--ink-900)]">
                    Policy da conversa (somente leitura)
                  </p>
                  <p className="mt-2 whitespace-pre-wrap">
                    {conversationPolicy.trim()
                      ? conversationPolicy
                      : "Nenhuma policy definida para esta conversa."}
                  </p>
                  <p className="mt-2 text-[10px] uppercase tracking-[0.2em]">
                    Edite no painel da conversa ativa
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="h-10 rounded-xl border border-black/10 px-4 text-xs font-semibold text-[color:var(--ink-900)]"
                    type="button"
                    onClick={handleOpenPrompt}
                    disabled={promptLoading || !selectedId}
                  >
                    Ver prompt completo
                  </button>
                </div>

                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-900)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    Diretivas automaticas (sinais e seguranca)
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-[color:var(--ink-900)]">
                    {localSignals.anger ? (
                      <li>- Usar modulo RAIN para ira/discussao.</li>
                    ) : null}
                    {localSignals.disconnect ? (
                      <li>- Ancorar no corpo e nomear sensacoes.</li>
                    ) : null}
                    {localSignals.rumination ? (
                      <li>- Redirecionar ruminacao para observacao e acao.</li>
                    ) : null}
                    {localSignals.highRisk ? (
                      <li>- Resposta de seguranca com orientacao de contato.</li>
                    ) : null}
                    {!localSignals.anger &&
                    !localSignals.disconnect &&
                    !localSignals.rumination &&
                    !localSignals.highRisk ? (
                      <li>- Nenhuma diretiva extra aplicada.</li>
                    ) : null}
                  </ul>
                </div>
              </div>
            ) : null}

            {psychPolicyTab === "context" ? (
              <div>
                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-900)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    Ultimas mensagens enviadas ao modelo (ate 20)
                  </p>
                  <div className="mt-3 max-h-[45vh] overflow-y-auto whitespace-pre-wrap">
                    {contextPreview.length ? contextPreview.join("\n\n") : "Sem contexto."}
                  </div>
                </div>
              </div>
            ) : null}

            {psychPolicyTab === "signals" ? (
              <div className="space-y-3">
                {(
                  [
                    { key: "anger", label: "Ira / discussao" },
                    { key: "disconnect", label: "Desconexao" },
                    { key: "rumination", label: "Ruminacao" },
                    { key: "highRisk", label: "Risco alto" },
                  ] as Array<{ key: SignalKey; label: string }>
                ).map((item) => (
                  <div
                    key={item.key}
                    className="rounded-2xl border border-black/10 bg-white/90 p-4"
                  >
                    <p className="text-xs font-semibold text-[color:var(--ink-900)]">
                      {item.label}
                    </p>
                    <label className="mt-3 block text-[11px] uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                      Palavras-chave (separe por virgula)
                    </label>
                    <input
                      className="mt-2 h-9 w-full rounded-xl border border-black/10 bg-white px-3 text-xs"
                      value={signalConfig[item.key].keywords.join(", ")}
                      onChange={(event) =>
                        updateSignalKeywords(item.key, event.target.value)
                      }
                    />
                    <label className="mt-3 block text-[11px] uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                      Diretiva automatica
                    </label>
                    <textarea
                      className="mt-2 min-h-[80px] w-full rounded-xl border border-black/10 bg-white p-3 text-xs"
                      value={signalConfig[item.key].directive}
                      onChange={(event) =>
                        updateSignalDirective(item.key, event.target.value)
                      }
                    />
                  </div>
                ))}

                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-900)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    Sinais detectados (analise local)
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {localSignals.highRisk ? (
                      <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700">
                        Risco alto
                      </span>
                    ) : null}
                    {localSignals.anger ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
                        Ira/discussao
                      </span>
                    ) : null}
                    {localSignals.disconnect ? (
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-700">
                        Desconexao
                      </span>
                    ) : null}
                    {localSignals.rumination ? (
                      <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs text-purple-700">
                        Ruminacao
                      </span>
                    ) : null}
                    {!localSignals.highRisk &&
                    !localSignals.anger &&
                    !localSignals.disconnect &&
                    !localSignals.rumination ? (
                      <span className="text-xs text-[color:var(--ink-500)]">
                        Nenhum sinal forte detectado.
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-900)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    Diretivas automaticas aplicadas
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-[color:var(--ink-900)]">
                    {localSignals.anger ? (
                      <li>- Usar modulo RAIN para ira/discussao.</li>
                    ) : null}
                    {localSignals.disconnect ? (
                      <li>- Ancorar no corpo e nomear sensacoes.</li>
                    ) : null}
                    {localSignals.rumination ? (
                      <li>- Redirecionar ruminacao para observacao e acao.</li>
                    ) : null}
                    {localSignals.highRisk ? (
                      <li>- Resposta de seguranca com orientacao de contato.</li>
                    ) : null}
                    {!localSignals.anger &&
                    !localSignals.disconnect &&
                    !localSignals.rumination &&
                    !localSignals.highRisk ? (
                      <li>- Nenhuma diretiva extra aplicada.</li>
                    ) : null}
                  </ul>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="h-10 rounded-xl bg-[color:var(--accent-500)] px-4 text-xs font-semibold text-white"
                    type="button"
                    onClick={() => handleSavePolicy("user")}
                    disabled={loading}
                  >
                    Salvar sinais/diretivas
                  </button>
                  <span className="text-xs text-[color:var(--ink-500)]">
                    {loading ? "Salvando..." : "Aplicar ao prompt do psicologo."}
                  </span>
                </div>
              </div>
            ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

