"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n";
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
    patientProfile?: {
      displayName?: string | null;
      preferredLanguage?: "PT" | "ES" | "EN";
    } | null;
  };
};

type MessageItem = {
  id: string;
  authorType: "PATIENT" | "PSYCHOLOGIST" | "AI" | "SYSTEM";
  content: string;
  createdAt: string;
  deletedAt?: string | null;
  hasAttachment?: boolean;
  attachmentMime?: string | null;
};

type RecordItem = {
  id: string;
  createdAt: string;
  dataJson: {
    event?: string;
    thought?: string;
    emotion?: string;
    body?: string;
    action?: string;
    result?: string;
  };
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
  psychologistName: string;
};

type WeeklySummary = {
  weekStart: string;
  weekEnd: string;
  events: Array<{ label: string; createdAt: string }>;
  dominantEmotions: Array<{ label: string; count: number }>;
  signalsTriggered: Array<{ key: SignalKey; count: number }>;
  changes: { messages: number; events: number; signals: number };
};

const formatAudioTime = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    return "0:00";
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const renderInlineBold = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`b-${index}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`t-${index}`}>{part}</span>;
  });
};

const renderLineWithHeading = (line: string) => {
  const trimmed = line.trim();
  const isHeading = /^\d+\)\s+/.test(trimmed);
  if (!isHeading) {
    return renderInlineBold(line);
  }
  return (
    <span className="font-semibold text-[color:var(--ink-900)]">
      {renderInlineBold(line)}
    </span>
  );
};

const renderFormattedContent = (content: string) => {
  const lines = content.split(/\r?\n/);
  const blocks: string[][] = [];
  let current: string[] = [];
  lines.forEach((line) => {
    if (line.trim() === "") {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  });
  if (current.length) {
    blocks.push(current);
  }

  return blocks.map((block, index) => {
    const isList = block.every((line) => /^(\s*[-*]|\s*\d+\.)\s+/.test(line));
    if (isList) {
      return (
        <ul key={`list-${index}`} className="ml-4 list-disc space-y-1">
          {block.map((line, itemIndex) => (
            <li key={`li-${itemIndex}`}>
              {renderInlineBold(line.replace(/^(\s*[-*]|\s*\d+\.)\s+/, ""))}
            </li>
          ))}
        </ul>
      );
    }
    const paragraphLines = block.join("\n").split("\n");
    return (
      <p key={`p-${index}`} className="whitespace-pre-wrap">
        {paragraphLines.map((line, lineIndex) => (
          <span key={`line-${lineIndex}`}>
            {renderLineWithHeading(line)}
            {lineIndex < paragraphLines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    );
  });
};

function AudioMessage({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const next = Number(event.target.value);
    audio.currentTime = next;
    setCurrentTime(next);
  };

  return (
    <div className="flex w-full items-center gap-3 rounded-2xl border border-black/10 bg-white/80 px-3 py-2 shadow-[0_10px_24px_var(--shadow-color)]">
      <audio
        ref={audioRef}
        src={src}
        className="hidden"
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) {
            return;
          }
          setDuration(audio.duration || 0);
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio) {
            return;
          }
          setCurrentTime(audio.currentTime || 0);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button
        type="button"
        onClick={togglePlay}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--accent-500)] text-white"
        aria-label={isPlaying ? "Pausar audio" : "Tocar audio"}
      >
        {isPlaying ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="currentColor"
          >
            <path d="M8 5v14l11-7-11-7Z" />
          </svg>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          className="h-2 w-full accent-[color:var(--accent-500)]"
        />
        <div className="flex items-center justify-between text-[11px] text-[color:var(--ink-500)]">
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

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

const SIGNAL_LABELS_BY_LANG: Record<"PT" | "ES" | "EN", Record<SignalKey, string>> = {
  PT: {
    anger: "Ira/discussao",
    disconnect: "Desconexao",
    rumination: "Ruminacao",
    highRisk: "Risco alto",
  },
  ES: {
    anger: "Ira/discusion",
    disconnect: "Desconexion",
    rumination: "Rumiacion",
    highRisk: "Riesgo alto",
  },
  EN: {
    anger: "Anger/discussion",
    disconnect: "Disconnection",
    rumination: "Rumination",
    highRisk: "High risk",
  },
};

const formatWeekLabel = (start: Date, end: Date) =>
  `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;

const formatDelta = (value: number) => (value > 0 ? `+${value}` : `${value}`);

const SUMMARY_COPY: Record<
  "PT" | "ES" | "EN",
  {
    title: string;
    tabs: { summary: string; emotions: string; evolution: string };
    weekSelected: string;
    weeksOptions: { four: string; eight: string; twelve: string; sixteen: string };
    refresh: string;
    exportCsv: string;
    autoGenerated: string;
    noData: string;
    eventsTitle: string;
    noEvents: string;
    emotionsTitle: string;
    noEmotions: string;
    signalsTitle: string;
    noSignals: string;
    changesTitle: string;
    compareTitle: string;
    compareMissing: string;
    compareHint: string;
    messagesLabel: string;
    recordsLabel: string;
    signalsLabel: string;
  }
> = {
  ES: {
    title: "Metricas de la conversacion",
    tabs: {
      summary: "Resumen semanal",
      emotions: "Emociones y senales",
      evolution: "Evolucion semanal",
    },
    weekSelected: "Semana seleccionada",
    weeksOptions: {
      four: "Ultimas 4 semanas",
      eight: "Ultimas 8 semanas",
      twelve: "Ultimas 12 semanas",
      sixteen: "Ultimas 16 semanas",
    },
    refresh: "Actualizar",
    exportCsv: "Exportar CSV",
    autoGenerated: "Generado automaticamente. Se actualiza con nuevos registros.",
    noData: "Sin datos suficientes para resumir.",
    eventsTitle: "Eventos registrados",
    noEvents: "No hay registros estructurados esta semana.",
    emotionsTitle: "Emociones predominantes",
    noEmotions: "No hay emociones registradas.",
    signalsTitle: "Senales clinicas disparadas",
    noSignals: "Ninguna senal disparada.",
    changesTitle: "Cambios vs semana anterior",
    compareTitle: "Comparativo semanal",
    compareMissing: "No hay semana anterior para comparar.",
    compareHint: "Comparado con la semana iniciada en",
    messagesLabel: "Mensajes",
    recordsLabel: "Registros",
    signalsLabel: "Senales",
  },
  PT: {
    title: "Metricas da conversa",
    tabs: {
      summary: "Resumo semanal",
      emotions: "Emocoes e sinais",
      evolution: "Evolucao semanal",
    },
    weekSelected: "Semana selecionada",
    weeksOptions: {
      four: "Ultimas 4 semanas",
      eight: "Ultimas 8 semanas",
      twelve: "Ultimas 12 semanas",
      sixteen: "Ultimas 16 semanas",
    },
    refresh: "Atualizar",
    exportCsv: "Exportar CSV",
    autoGenerated: "Gerado automaticamente. Atualiza com novos registros.",
    noData: "Sem dados suficientes para resumir.",
    eventsTitle: "Eventos registrados",
    noEvents: "Nenhum registro estruturado nesta semana.",
    emotionsTitle: "Emocoes predominantes",
    noEmotions: "Nenhuma emocao registrada.",
    signalsTitle: "Sinais clinicos disparados",
    noSignals: "Nenhum sinal disparado.",
    changesTitle: "Mudancas vs semana anterior",
    compareTitle: "Comparativo semanal",
    compareMissing: "Nao ha semana anterior para comparar.",
    compareHint: "Comparado com a semana iniciada em",
    messagesLabel: "Mensagens",
    recordsLabel: "Registros",
    signalsLabel: "Sinais",
  },
  EN: {
    title: "Conversation metrics",
    tabs: {
      summary: "Weekly summary",
      emotions: "Emotions and signals",
      evolution: "Weekly evolution",
    },
    weekSelected: "Selected week",
    weeksOptions: {
      four: "Last 4 weeks",
      eight: "Last 8 weeks",
      twelve: "Last 12 weeks",
      sixteen: "Last 16 weeks",
    },
    refresh: "Refresh",
    exportCsv: "Export CSV",
    autoGenerated: "Auto-generated. Updates with new records.",
    noData: "Not enough data to summarize.",
    eventsTitle: "Logged events",
    noEvents: "No structured records this week.",
    emotionsTitle: "Dominant emotions",
    noEmotions: "No emotions recorded.",
    signalsTitle: "Triggered clinical signals",
    noSignals: "No signals triggered.",
    changesTitle: "Changes vs previous week",
    compareTitle: "Weekly comparison",
    compareMissing: "No previous week to compare.",
    compareHint: "Compared with the week starting",
    messagesLabel: "Messages",
    recordsLabel: "Records",
    signalsLabel: "Signals",
  },
};

const PSYCH_COPY: Record<
  "PT" | "ES" | "EN",
  {
    activeChat: string;
    conversationsTitle: string;
    selectConversation: string;
    searchPlaceholder: string;
    filterLabel: string;
    filterAll: string;
    filterEnabled: string;
    filterDisabled: string;
    sortLabel: string;
    sortRecent: string;
    sortName: string;
    noConversations: string;
    aiOn: string;
    aiOff: string;
    patientLanguage: string;
    episodeLabel: string;
    episodeClosed: string;
    toggleAiOn: string;
    toggleAiOff: string;
    conversationPolicy: string;
    saveRecord: string;
    menu: string;
    close: string;
    policyTitle: string;
    psychologistPolicyTitle: string;
    psychologistPolicyDesc: string;
    policyAssistant: string;
    policyHint: string;
    draft: string;
    append: string;
    clearSelection: string;
    edit: string;
    policySave: string;
    policyReview: string;
    autoSaved: string;
    autoSaveError: string;
    policyAppliesAll: string;
    tabPolicy: string;
    tabContext: string;
    tabSignals: string;
    promptStructureTitle: string;
    promptStructure1: string;
    promptStructure2: string;
    promptStructure3: string;
    policyEditableLabel: string;
    aiTuningTitle: string;
    maxTokensLabel: string;
    maxTurnsLabel: string;
    disableEpisodeLabel: string;
    temperatureLabel: string;
    resetDefaultLabel: string;
    resetButton: string;
    conversationPolicyReadOnly: string;
    conversationPolicyEmpty: string;
    conversationPolicyEditHint: string;
    promptFull: string;
    promptTitle: string;
    promptClose: string;
    directivesTitle: string;
    directivesNone: string;
    contextTitle: string;
    contextEmpty: string;
    keywordsLabel: string;
    directiveLabel: string;
    signalsDetectedTitle: string;
    signalsDetectedNone: string;
    directivesAppliedTitle: string;
    saveSignals: string;
    saving: string;
    applyPromptHint: string;
    metricsClose: string;
    directiveAnger: string;
    directiveDisconnect: string;
    directiveRumination: string;
    directiveHighRisk: string;
    chatToday: string;
    chatYesterday: string;
    objective: string;
    objectivePlaceholder: string;
    saveConversationPolicy: string;
    recordTitle: string;
    recordSubtitle: string;
    recordEvent: string;
    recordThought: string;
    recordEmotion: string;
    recordBody: string;
    recordAction: string;
    recordResult: string;
    recordSave: string;
    recordClose: string;
    sendPlaceholder: string;
    recording: string;
    audioPreview: string;
    demoSendDisabled: string;
    demoRecordDisabled: string;
    unsupportedAudio: string;
    recordMissingEvent: string;
    recordSaved: string;
  }
> = {
  ES: {
    activeChat: "Conversacion activa",
    conversationsTitle: "Conversaciones",
    selectConversation: "Seleccione una conversacion",
    searchPlaceholder: "Buscar paciente...",
    filterLabel: "IA",
    filterAll: "todos",
    filterEnabled: "activada",
    filterDisabled: "desactivada",
    sortLabel: "Ordenar",
    sortRecent: "recientes",
    sortName: "nombre",
    noConversations: "No se encontraron conversaciones.",
    aiOn: "IA activada",
    aiOff: "IA desactivada",
    patientLanguage: "Idioma del paciente:",
    episodeLabel: "Episodio:",
    episodeClosed: "(cerrado)",
    toggleAiOn: "Encender IA",
    toggleAiOff: "Apagar IA",
    conversationPolicy: "Politica de la conversacion",
    saveRecord: "Guardar registro",
    menu: "Menu",
    close: "Cerrar",
    policyTitle: "Politica de la conversacion",
    psychologistPolicyTitle: "Politica del psicologo",
    psychologistPolicyDesc:
      "Defina tono y limites personales para todas las conversaciones.",
    policyAssistant: "Asistente de politica",
    policyHint: "Seleccione directivas para generar un borrador base.",
    draft: "Generar borrador",
    append: "Agregar al texto",
    clearSelection: "Limpiar seleccion",
    edit: "Editar",
    policySave: "Guardar politica del psicologo",
    policyReview: "Revisar antes de guardar.",
    autoSaved: "Guardado automaticamente",
    autoSaveError: "Error al guardar",
    policyAppliesAll: "Esta politica se aplica a todas las conversaciones.",
    tabPolicy: "Politica",
    tabContext: "Contexto",
    tabSignals: "Senales",
    promptStructureTitle: "Estructura del prompt (system)",
    promptStructure1: "1) Politica del psicologo (editable)",
    promptStructure2: "2) Politica de la conversacion (editable en el chat)",
    promptStructure3: "3) Directivas automaticas (senales y seguridad)",
    policyEditableLabel: "Politica del psicologo (editable)",
    aiTuningTitle: "Ajustes de IA (por psicologo)",
    maxTokensLabel: "Max tokens",
    maxTurnsLabel: "Max turns por episodio",
    disableEpisodeLabel: "Desactivar limite de episodio",
    temperatureLabel: "Temperatura",
    resetDefaultLabel: "Restaurar por defecto",
    resetButton: "Resetear",
    conversationPolicyReadOnly: "Politica de la conversacion (solo lectura)",
    conversationPolicyEmpty: "No hay politica definida para esta conversacion.",
    conversationPolicyEditHint: "Edite en el panel de la conversacion activa",
    promptFull: "Ver prompt completo",
    promptTitle: "Prompt de la IA (preview)",
    promptClose: "Cerrar",
    directivesTitle: "Directivas automaticas (senales y seguridad)",
    directivesNone: "Ninguna directiva extra aplicada.",
    contextTitle: "Ultimos mensajes enviados al modelo (hasta 20)",
    contextEmpty: "Sin contexto.",
    keywordsLabel: "Palabras clave (separe por coma)",
    directiveLabel: "Directiva automatica",
    signalsDetectedTitle: "Senales detectadas (analisis local)",
    signalsDetectedNone: "Ninguna senal fuerte detectada.",
    directivesAppliedTitle: "Directivas automaticas aplicadas",
    saveSignals: "Guardar senales/directivas",
    saving: "Guardando...",
    applyPromptHint: "Aplicar al prompt del psicologo.",
    metricsClose: "Cerrar",
    directiveAnger: "Usar modulo RAIN para ira/discusion.",
    directiveDisconnect: "Anclar en el cuerpo y nombrar sensaciones.",
    directiveRumination: "Redirigir rumiacion a observacion y accion.",
    directiveHighRisk: "Respuesta de seguridad con orientacion de contacto.",
    chatToday: "Hoy",
    chatYesterday: "Ayer",
    objective: "Objetivo del momento",
    objectivePlaceholder: "Ej: reducir ruminacion esta semana con pequenas acciones",
    saveConversationPolicy: "Guardar politica de la conversacion",
    recordTitle: "Guardar registro",
    recordSubtitle:
      "Evento -> pensamiento/emocion -> sensacion corporal -> accion -> resultado.",
    recordEvent: "Evento",
    recordThought: "Pensamiento",
    recordEmotion: "Emocion",
    recordBody: "Sensacion corporal",
    recordAction: "Accion",
    recordResult: "Resultado",
    recordSave: "Guardar registro",
    recordClose: "Cerrar",
    sendPlaceholder: "Escriba una respuesta...",
    recording: "Grabando audio",
    audioPreview: "Previa del audio",
    demoSendDisabled: "Conversacion demo: envio desactivado.",
    demoRecordDisabled: "Conversacion demo: registro desactivado.",
    unsupportedAudio: "Grabacion de audio no soportada en este navegador.",
    recordMissingEvent: "Informe el evento antes de guardar.",
    recordSaved: "Registro guardado.",
  },
  PT: {
    activeChat: "Conversa ativa",
    conversationsTitle: "Conversas",
    selectConversation: "Selecione uma conversa",
    searchPlaceholder: "Buscar paciente...",
    filterLabel: "IA",
    filterAll: "todos",
    filterEnabled: "ligada",
    filterDisabled: "desligada",
    sortLabel: "Ordenar",
    sortRecent: "recentes",
    sortName: "nome",
    noConversations: "Nenhuma conversa encontrada.",
    aiOn: "IA habilitada",
    aiOff: "IA desativada",
    patientLanguage: "Idioma do paciente:",
    episodeLabel: "Episodio:",
    episodeClosed: "(fechado)",
    toggleAiOn: "Ligar IA",
    toggleAiOff: "Desligar IA",
    conversationPolicy: "Politica da conversa",
    saveRecord: "Salvar registro",
    menu: "Menu",
    close: "Fechar",
    policyTitle: "Politica da conversa",
    psychologistPolicyTitle: "Politica do psicologo",
    psychologistPolicyDesc:
      "Defina tom e limites pessoais para todas as conversas.",
    policyAssistant: "Assistente de politica",
    policyHint: "Selecione diretrizes para gerar um rascunho base.",
    draft: "Gerar rascunho",
    append: "Adicionar ao texto",
    clearSelection: "Limpar selecao",
    edit: "Editar",
    policySave: "Salvar policy do psicologo",
    policyReview: "Revisar antes de salvar.",
    autoSaved: "Salvo automaticamente",
    autoSaveError: "Erro ao salvar",
    policyAppliesAll: "Esta politica se aplica a todas as conversas.",
    tabPolicy: "Policy",
    tabContext: "Contexto",
    tabSignals: "Sinais",
    promptStructureTitle: "Estrutura do prompt (system)",
    promptStructure1: "1) Policy do psicologo (editavel)",
    promptStructure2: "2) Policy da conversa (editavel no chat ativo)",
    promptStructure3: "3) Diretivas automaticas (sinais e seguranca)",
    policyEditableLabel: "Policy do psicologo (editavel)",
    aiTuningTitle: "Ajustes da IA (por psicologo)",
    maxTokensLabel: "Max tokens",
    maxTurnsLabel: "Max turns por episodio",
    disableEpisodeLabel: "Desativar limite de episodio",
    temperatureLabel: "Temperatura",
    resetDefaultLabel: "Restaurar padrao",
    resetButton: "Resetar",
    conversationPolicyReadOnly: "Policy da conversa (somente leitura)",
    conversationPolicyEmpty: "Nenhuma policy definida para esta conversa.",
    conversationPolicyEditHint: "Edite no painel da conversa ativa",
    promptFull: "Ver prompt completo",
    promptTitle: "Prompt da IA (preview)",
    promptClose: "Fechar",
    directivesTitle: "Diretivas automaticas (sinais e seguranca)",
    directivesNone: "Nenhuma diretiva extra aplicada.",
    contextTitle: "Ultimas mensagens enviadas ao modelo (ate 20)",
    contextEmpty: "Sem contexto.",
    keywordsLabel: "Palavras-chave (separe por virgula)",
    directiveLabel: "Diretiva automatica",
    signalsDetectedTitle: "Sinais detectados (analise local)",
    signalsDetectedNone: "Nenhum sinal forte detectado.",
    directivesAppliedTitle: "Diretivas automaticas aplicadas",
    saveSignals: "Salvar sinais/diretivas",
    saving: "Salvando...",
    applyPromptHint: "Aplicar ao prompt do psicologo.",
    metricsClose: "Fechar",
    directiveAnger: "Usar modulo RAIN para ira/discussao.",
    directiveDisconnect: "Ancorar no corpo e nomear sensacoes.",
    directiveRumination: "Redirecionar ruminacao para observacao e acao.",
    directiveHighRisk: "Resposta de seguranca com orientacao de contato.",
    chatToday: "Hoje",
    chatYesterday: "Ontem",
    objective: "Objetivo do momento",
    objectivePlaceholder: "Ex: reduzir ruminacao esta semana com pequenas acoes",
    saveConversationPolicy: "Salvar policy da conversa",
    recordTitle: "Salvar registro",
    recordSubtitle:
      "Evento -> pensamento/emocao -> sensacao corporal -> acao -> resultado.",
    recordEvent: "Evento",
    recordThought: "Pensamento",
    recordEmotion: "Emocao",
    recordBody: "Sensacao corporal",
    recordAction: "Acao",
    recordResult: "Resultado",
    recordSave: "Salvar registro",
    recordClose: "Fechar",
    sendPlaceholder: "Escreva uma resposta...",
    recording: "Gravando audio",
    audioPreview: "Previa do audio",
    demoSendDisabled: "Conversa de demonstracao: envio desativado.",
    demoRecordDisabled: "Conversa de demonstracao: registro desativado.",
    unsupportedAudio: "Gravacao de audio nao suportada neste navegador.",
    recordMissingEvent: "Informe o evento antes de salvar.",
    recordSaved: "Registro salvo.",
  },
  EN: {
    activeChat: "Active chat",
    conversationsTitle: "Conversations",
    selectConversation: "Select a conversation",
    searchPlaceholder: "Search patient...",
    filterLabel: "AI",
    filterAll: "all",
    filterEnabled: "enabled",
    filterDisabled: "disabled",
    sortLabel: "Sort",
    sortRecent: "recent",
    sortName: "name",
    noConversations: "No conversations found.",
    aiOn: "AI enabled",
    aiOff: "AI disabled",
    patientLanguage: "Patient language:",
    episodeLabel: "Episode:",
    episodeClosed: "(closed)",
    toggleAiOn: "Enable AI",
    toggleAiOff: "Disable AI",
    conversationPolicy: "Conversation policy",
    saveRecord: "Save record",
    menu: "Menu",
    close: "Close",
    policyTitle: "Conversation policy",
    psychologistPolicyTitle: "Psychologist policy",
    psychologistPolicyDesc:
      "Define tone and personal limits for all conversations.",
    policyAssistant: "Policy assistant",
    policyHint: "Select directives to generate a base draft.",
    draft: "Generate draft",
    append: "Append to text",
    clearSelection: "Clear selection",
    edit: "Edit",
    policySave: "Save psychologist policy",
    policyReview: "Review before saving.",
    autoSaved: "Auto-saved",
    autoSaveError: "Save error",
    policyAppliesAll: "This policy applies to all conversations.",
    tabPolicy: "Policy",
    tabContext: "Context",
    tabSignals: "Signals",
    promptStructureTitle: "Prompt structure (system)",
    promptStructure1: "1) Psychologist policy (editable)",
    promptStructure2: "2) Conversation policy (editable in chat)",
    promptStructure3: "3) Automatic directives (signals and safety)",
    policyEditableLabel: "Psychologist policy (editable)",
    aiTuningTitle: "AI settings (per psychologist)",
    maxTokensLabel: "Max tokens",
    maxTurnsLabel: "Max turns per episode",
    disableEpisodeLabel: "Disable episode limit",
    temperatureLabel: "Temperature",
    resetDefaultLabel: "Restore default",
    resetButton: "Reset",
    conversationPolicyReadOnly: "Conversation policy (read only)",
    conversationPolicyEmpty: "No policy defined for this conversation.",
    conversationPolicyEditHint: "Edit in the active conversation panel",
    promptFull: "View full prompt",
    promptTitle: "AI prompt (preview)",
    promptClose: "Close",
    directivesTitle: "Automatic directives (signals and safety)",
    directivesNone: "No extra directive applied.",
    contextTitle: "Latest messages sent to the model (up to 20)",
    contextEmpty: "No context.",
    keywordsLabel: "Keywords (comma separated)",
    directiveLabel: "Automatic directive",
    signalsDetectedTitle: "Detected signals (local analysis)",
    signalsDetectedNone: "No strong signals detected.",
    directivesAppliedTitle: "Applied automatic directives",
    saveSignals: "Save signals/directives",
    saving: "Saving...",
    applyPromptHint: "Apply to psychologist prompt.",
    metricsClose: "Close",
    directiveAnger: "Use RAIN module for anger/discussion.",
    directiveDisconnect: "Anchor to the body and name sensations.",
    directiveRumination: "Redirect rumination to observation and action.",
    directiveHighRisk: "Safety response with contact guidance.",
    chatToday: "Today",
    chatYesterday: "Yesterday",
    objective: "Current goal",
    objectivePlaceholder: "E.g. reduce rumination this week with small actions",
    saveConversationPolicy: "Save conversation policy",
    recordTitle: "Save record",
    recordSubtitle:
      "Event -> thought/emotion -> body sensation -> action -> outcome.",
    recordEvent: "Event",
    recordThought: "Thought",
    recordEmotion: "Emotion",
    recordBody: "Body sensation",
    recordAction: "Action",
    recordResult: "Outcome",
    recordSave: "Save record",
    recordClose: "Close",
    sendPlaceholder: "Write a reply...",
    recording: "Recording audio",
    audioPreview: "Audio preview",
    demoSendDisabled: "Demo conversation: sending disabled.",
    demoRecordDisabled: "Demo conversation: record disabled.",
    unsupportedAudio: "Audio recording is not supported in this browser.",
    recordMissingEvent: "Provide the event before saving.",
    recordSaved: "Record saved.",
  },
};

// weekly summaries are computed server-side and cached

const DEMO_CONVERSATION_ID = "__demo__";
const demoConversation: ConversationItem = {
  id: DEMO_CONVERSATION_ID,
  aiEnabled: true,
  updatedAt: new Date().toISOString(),
  patient: {
    id: "demo-patient",
    email: "paciente.demo@psyos.local",
    patientProfile: { displayName: "Paciente demo", preferredLanguage: "ES" },
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

const LANGUAGE_DIRECTIVE: Record<"PT" | "ES" | "EN", string> = {
  PT: "Responda sempre em portugues.",
  ES: "Responda sempre em espanhol.",
  EN: "Respond in English.",
};

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

export default function PsychologistClient({ tenantId, psychologistName }: Props) {
  const { t, language } = useLanguage();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordTimerRef = useRef<number | null>(null);
  const [pendingAudioUrl, setPendingAudioUrl] = useState<string | null>(null);
  const [pendingAudioBlob, setPendingAudioBlob] = useState<Blob | null>(null);
  const MAX_RECORD_SECONDS = 120;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [policySelections, setPolicySelections] = useState<string[]>([]);
  const [policyObjective, setPolicyObjective] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptSnapshot, setPromptSnapshot] = useState<PromptResponse["item"]>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [autoSaveState, setAutoSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
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
  const [disableEpisodeLimit, setDisableEpisodeLimit] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAi, setFilterAi] = useState<"all" | "enabled" | "disabled">("all");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
  const [showInsights, setShowInsights] = useState(false);
  const [insightTab, setInsightTab] = useState<
    "summary" | "emotions" | "evolution"
  >("summary");
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [weeklySummaries, setWeeklySummaries] = useState<WeeklySummary[]>([]);
  const [weeksCount, setWeeksCount] = useState(8);
  const [typingId, setTypingId] = useState<string | null>(null);
  const [typingText, setTypingText] = useState("");
  const [typingIndex, setTypingIndex] = useState(0);
  const typingDoneRef = useRef<Set<string>>(new Set());
  const typingInitializedRef = useRef(false);

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
  const summaryLanguage =
    selectedConversation?.patient.patientProfile?.preferredLanguage ?? "ES";
  const uiLanguage =
    (language?.toUpperCase() as "PT" | "ES" | "EN" | undefined) ?? "ES";
  const psychCopy = PSYCH_COPY[uiLanguage] ?? PSYCH_COPY.ES;
  const summaryCopy = SUMMARY_COPY[summaryLanguage];
  const summarySignalLabels = SIGNAL_LABELS_BY_LANG[summaryLanguage];
  const uiSignalLabels = SIGNAL_LABELS_BY_LANG[uiLanguage];
  const locale = uiLanguage === "PT" ? "pt-BR" : uiLanguage === "ES" ? "es-ES" : "en-US";
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  const formatDayLabel = (value: string) => {
    const date = new Date(value);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays =
      (startOfToday.getTime() - startOfDate.getTime()) / (24 * 60 * 60 * 1000);
    if (diffDays === 0) {
      return psychCopy.chatToday;
    }
    if (diffDays === 1) {
      return psychCopy.chatYesterday;
    }
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  };
  const showAiWaiting = useMemo(() => {
    if (!selectedConversation?.aiEnabled) {
      return false;
    }
    if (!messages.length) {
      return false;
    }
    const lastPatient = [...messages]
      .reverse()
      .find((message) => message.authorType === "PATIENT");
    if (!lastPatient) {
      return false;
    }
    const lastAi = [...messages].reverse().find((message) => message.authorType === "AI");
    if (!lastAi) {
      return true;
    }
    return new Date(lastAi.createdAt).getTime() < new Date(lastPatient.createdAt).getTime();
  }, [messages, selectedConversation?.aiEnabled]);

  useEffect(() => {
    typingDoneRef.current = new Set();
    typingInitializedRef.current = false;
    setTypingId(null);
    setTypingText("");
    setTypingIndex(0);
  }, [selectedId]);

  useEffect(() => {
    if (!typingInitializedRef.current) {
      messages
        .filter((message) => message.authorType === "AI")
        .forEach((message) => typingDoneRef.current.add(message.id));
      typingInitializedRef.current = true;
      return;
    }
    const lastAi = [...messages].reverse().find((message) => message.authorType === "AI");
    if (!lastAi) {
      return;
    }
    if (typingDoneRef.current.has(lastAi.id) || typingId === lastAi.id) {
      return;
    }
    setTypingId(lastAi.id);
    setTypingText(lastAi.content);
    setTypingIndex(0);
  }, [messages, typingId]);

  useEffect(() => {
    if (!typingId) {
      return;
    }
    if (typingIndex >= typingText.length) {
      typingDoneRef.current.add(typingId);
      setTypingId(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      setTypingIndex((current) => Math.min(current + 2, typingText.length));
    }, 18);
    return () => window.clearTimeout(timeout);
  }, [typingId, typingIndex, typingText.length]);

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

  const selectedSummary = useMemo(
    () => weeklySummaries.find((item) => item.weekStart === selectedWeek) ?? null,
    [weeklySummaries, selectedWeek],
  );
  const previousSummary = useMemo(() => {
    if (!selectedSummary) {
      return null;
    }
    const index = weeklySummaries.findIndex(
      (item) => item.weekStart === selectedSummary.weekStart,
    );
    if (index === -1) {
      return null;
    }
    return weeklySummaries[index + 1] ?? null;
  }, [weeklySummaries, selectedSummary]);

  const summaryDeltas = useMemo(() => {
    if (!selectedSummary) {
      return null;
    }
    const prev = previousSummary;
    return {
      messages: prev
        ? selectedSummary.changes.messages - prev.changes.messages
        : selectedSummary.changes.messages,
      events: prev
        ? selectedSummary.changes.events - prev.changes.events
        : selectedSummary.changes.events,
      signals: prev
        ? selectedSummary.changes.signals - prev.changes.signals
        : selectedSummary.changes.signals,
    };
  }, [selectedSummary, previousSummary]);

  useEffect(() => {
    if (weeklySummaries.length === 0) {
      setSelectedWeek(null);
      return;
    }
    if (!selectedWeek || !weeklySummaries.some((item) => item.weekStart === selectedWeek)) {
      setSelectedWeek(weeklySummaries[0].weekStart);
    }
  }, [weeklySummaries, selectedWeek]);

  useEffect(() => {
    if (selectedId) {
      loadWeeklySummaries(selectedId, { weeks: weeksCount });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeksCount]);

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
      setRecords([]);
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

  const loadRecords = async (conversationId: string) => {
    if (conversationId === DEMO_CONVERSATION_ID) {
      setRecords([]);
      setWeeklySummaries([]);
      return;
    }
    try {
      const response = await fetch(`/api/records?conversationId=${conversationId}`, {
        method: "GET",
      });
      if (!response.ok) {
        setRecords([]);
        return;
      }
      const data = (await response.json().catch(() => ({}))) as {
        items?: RecordItem[];
      };
      setRecords(data.items ?? []);
    } catch (error) {
      console.error(error);
    }
  };

  const loadWeeklySummaries = async (
    conversationId: string,
    options?: { refresh?: boolean; weeks?: number },
  ) => {
    if (conversationId === DEMO_CONVERSATION_ID) {
      setWeeklySummaries([]);
      return;
    }
    try {
      const params = new URLSearchParams({
        conversationId,
        weeks: String(options?.weeks ?? weeksCount),
      });
      if (options?.refresh) {
        params.set("refresh", "true");
      }
      const data = await getJson<{ items: WeeklySummary[] }>(
        `/api/insights/weekly?${params.toString()}`,
      );
      setWeeklySummaries(data.items ?? []);
    } catch (error) {
      console.error(error);
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
        | { maxTokens?: number; maxTurns?: number; temperature?: number; disableEpisodeLimit?: boolean }
        | undefined;
      setAiMaxTokens(settings?.maxTokens ?? 300);
      setAiMaxTurns(settings?.maxTurns ?? 3);
      setAiTemperature(settings?.temperature ?? 0.4);
      setDisableEpisodeLimit(Boolean(settings?.disableEpisodeLimit));
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
    setShowInsights(false);
    await Promise.all([
      loadMessages(conversationId),
      loadPolicies(conversationId),
      loadEpisode(conversationId),
      loadRecords(conversationId),
      loadWeeklySummaries(conversationId),
    ]);
  };

  const handleSendMessage = async () => {
    if (!selectedId || !messageDraft.trim()) {
      return;
    }
    if (selectedId === DEMO_CONVERSATION_ID) {
      setStatus(psychCopy.demoSendDisabled);
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

  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedId) {
      return;
    }
    try {
      setLoading(true);
      const response = await fetch(`/api/messages/${messageId}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Request failed");
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { ...message, deletedAt: new Date().toISOString(), content: "" }
            : message,
        ),
      );
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const sendAudioBlob = async (blob: Blob) => {
    if (!selectedId) {
      return;
    }
    try {
      setLoading(true);
      const form = new FormData();
      form.append("tenantId", tenantId);
      form.append("conversationId", selectedId);
      form.append("file", new File([blob], "audio.webm", { type: blob.type }));
      const response = await fetch("/api/messages/audio", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Request failed");
      }
      await Promise.all([loadMessages(selectedId), loadEpisode(selectedId)]);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const startRecording = async () => {
    if (!selectedId || isRecording) {
      return;
    }
    if (selectedId === DEMO_CONVERSATION_ID) {
      setStatus(psychCopy.demoSendDisabled);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(psychCopy.unsupportedAudio);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        recordChunksRef.current = [];
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          setPendingAudioBlob(blob);
          setPendingAudioUrl(url);
        }
        setRecordSeconds(0);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((current) => {
          const next = current + 1;
          if (next >= MAX_RECORD_SECONDS) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) {
      return;
    }
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    recordChunksRef.current = [];
    if (pendingAudioUrl) {
      URL.revokeObjectURL(pendingAudioUrl);
    }
    setPendingAudioUrl(null);
    setPendingAudioBlob(null);
  };

  const formatSeconds = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remaining
      .toString()
      .padStart(2, "0")}`;
  };

  const sendPendingAudio = async () => {
    if (!pendingAudioBlob) {
      return;
    }
    await sendAudioBlob(pendingAudioBlob);
    if (pendingAudioUrl) {
      URL.revokeObjectURL(pendingAudioUrl);
    }
    setPendingAudioUrl(null);
    setPendingAudioBlob(null);
  };

  const handleSavePolicy = async (scope: "user" | "conversation") => {
    if (scope === "conversation" && !selectedId) {
      return;
    }
    if (scope === "user" && !psychPolicy.trim()) {
      return;
    }
    try {
      setLoading(true);
      setAutoSaveState(scope === "user" ? "saving" : "idle");
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
                    disableEpisodeLimit,
                  },
                }
              : undefined,
      });
      if (scope === "user") {
        setAutoSaveState("saved");
        window.setTimeout(() => {
          setAutoSaveState("idle");
        }, 1200);
      }
      setStatus("Policy salva.");
    } catch (error) {
      setStatus((error as Error).message);
      if (scope === "user") {
        setAutoSaveState("error");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    if (!psychPolicy.trim()) {
      return;
    }
    const timeout = window.setTimeout(() => {
      handleSavePolicy("user");
    }, 500);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMaxTokens, aiMaxTurns, aiTemperature, disableEpisodeLimit, signalConfig]);

  const handleToggleAi = async () => {
    if (!selectedId || selectedId === DEMO_CONVERSATION_ID) {
      setStatus(psychCopy.demoSendDisabled);
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
      setStatus(psychCopy.recordMissingEvent);
      return;
    }
    if (selectedId === DEMO_CONVERSATION_ID) {
      setStatus(psychCopy.demoRecordDisabled);
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
      await loadRecords(selectedId);
      await loadWeeklySummaries(selectedId);
      setStatus(psychCopy.recordSaved);
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
    const preferredLanguage =
      selectedConversation?.patient.patientProfile?.preferredLanguage ?? "ES";
    const extraDirectives = [
      LANGUAGE_DIRECTIVE[preferredLanguage],
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
      setShowInsights(false);
      loadEpisode(selectedId);
      loadRecords(selectedId);
      loadWeeklySummaries(selectedId);
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
                    {psychCopy.psychologistPolicyTitle}
                  </p>
                  <p className="mt-2 text-sm text-[color:var(--ink-900)]">
                    {psychCopy.psychologistPolicyDesc}
                  </p>
                </div>
                <button
                  className="rounded-full border border-black/10 px-3 py-2 text-xs font-semibold text-[color:var(--ink-900)]"
                  type="button"
                  onClick={handleOpenPsychPolicy}
                >
                  {psychCopy.edit}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl text-[color:var(--ink-900)]">
                  {psychCopy.conversationsTitle}
                </h1>
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
              placeholder={psychCopy.searchPlaceholder}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-[color:var(--ink-500)]">
            <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-3 py-1">
              <span>{psychCopy.filterLabel}</span>
              <select
                className="bg-transparent text-[11px]"
                value={filterAi}
                onChange={(event) =>
                  setFilterAi(event.target.value as "all" | "enabled" | "disabled")
                }
              >
                <option value="all">{psychCopy.filterAll}</option>
                <option value="enabled">{psychCopy.filterEnabled}</option>
                <option value="disabled">{psychCopy.filterDisabled}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-3 py-1">
              <span>{psychCopy.sortLabel}</span>
              <select
                className="bg-transparent text-[11px]"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as "recent" | "name")}
              >
                <option value="recent">{psychCopy.sortRecent}</option>
                <option value="name">{psychCopy.sortName}</option>
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
              {psychCopy.noConversations}
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
          ? [`- ${psychCopy.objective}: ${policyObjective.trim()}`]
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
                {psychCopy.menu}
              </p>
              <button
                type="button"
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {psychCopy.close}
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
                {psychCopy.activeChat}
              </p>
              <h2 className="text-2xl text-[color:var(--ink-900)]">
                {selectedConversation
                  ? selectedConversation.patient.patientProfile?.displayName ??
                    selectedConversation.patient.email ??
                    "Paciente"
                  : psychCopy.selectConversation}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)] lg:hidden"
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
              >
                {psychCopy.menu}
              </button>
              <span className="text-xs text-[color:var(--ink-500)]">
                {selectedConversation?.aiEnabled ? psychCopy.aiOn : psychCopy.aiOff}
              </span>
              <span className="text-xs text-[color:var(--ink-500)]">
                {psychCopy.patientLanguage}{" "}
                {selectedConversation?.patient.patientProfile?.preferredLanguage ??
                  "ES"}
              </span>
              <span className="text-xs text-[color:var(--ink-500)]">
                {psychCopy.episodeLabel}{" "}
                {disableEpisodeLimit
                  ? "∞"
                  : aiTurnsUsed === null
                    ? "-"
                    : `${aiTurnsUsed}/${aiMaxTurns}`}
                {episodeOpen === false && !disableEpisodeLimit
                  ? ` ${psychCopy.episodeClosed}`
                  : ""}
              </span>
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                type="button"
                onClick={handleToggleAi}
                disabled={!selectedId || selectedId === DEMO_CONVERSATION_ID}
              >
                {selectedConversation?.aiEnabled
                  ? psychCopy.toggleAiOff
                  : psychCopy.toggleAiOn}
              </button>
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                type="button"
                onClick={() => setShowConversationPolicy((current) => !current)}
                disabled={!selectedId}
              >
                {psychCopy.conversationPolicy}
              </button>
              <button
                className="rounded-full bg-[color:var(--accent-500)] px-3 py-1 text-xs font-semibold text-white"
                type="button"
                onClick={() => setShowRecord((current) => !current)}
                disabled={!selectedId}
              >
                {psychCopy.saveRecord}
              </button>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-[color:var(--ink-900)]"
                type="button"
                onClick={() => setShowInsights(true)}
                aria-label="Abrir metricas da conversa"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M3 12h18" />
                  <path d="M3 18h18" />
                </svg>
              </button>
            </div>
          </div>

          {showConversationPolicy ? (
            <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 p-4">
              <h3 className="text-sm font-semibold text-[color:var(--ink-900)]">
                {psychCopy.policyTitle}
              </h3>
              <div className="mt-3 rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4">
                <p className="text-xs font-semibold text-[color:var(--ink-900)]">
                  {psychCopy.policyAssistant}
                </p>
                <p className="mt-1 text-xs text-[color:var(--ink-500)]">
                  {psychCopy.policyHint}
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
                  {psychCopy.draft}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                  onClick={() => applyPolicyDraft("append")}
                >
                  {psychCopy.append}
                </button>
                  <button
                    type="button"
                    className="text-xs text-[color:var(--ink-500)]"
                    onClick={() => {
                      setPolicySelections([]);
                      setPolicyObjective("");
                    }}
                  >
                    {psychCopy.clearSelection}
                  </button>
              </div>
              <div className="mt-4">
                <label className="text-xs font-semibold text-[color:var(--ink-900)]">
                  {psychCopy.objective}
                </label>
                <input
                  className="mt-2 h-10 w-full rounded-xl border border-black/10 bg-white/90 px-3 text-sm"
                  placeholder={psychCopy.objectivePlaceholder}
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
                  {psychCopy.saveConversationPolicy}
                </button>
                <button
                  className="text-xs text-[color:var(--ink-500)]"
                  type="button"
                  onClick={() => setShowConversationPolicy(false)}
                >
                  {psychCopy.close}
                </button>
              </div>
            </div>
          ) : null}

          {showRecord ? (
            <div className="mt-6 rounded-2xl border border-black/10 bg-white/90 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[color:var(--ink-900)]">
                  {psychCopy.recordTitle}
                </h3>
                <button
                  className="text-xs text-[color:var(--ink-500)]"
                  type="button"
                  onClick={() => setShowRecord(false)}
                >
                  {psychCopy.recordClose}
                </button>
              </div>
              <p className="mt-2 text-xs text-[color:var(--ink-500)]">
                {psychCopy.recordSubtitle}
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder={psychCopy.recordEvent}
                  value={recordEvent}
                  onChange={(event) => setRecordEvent(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder={psychCopy.recordThought}
                  value={recordThought}
                  onChange={(event) => setRecordThought(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder={psychCopy.recordEmotion}
                  value={recordEmotion}
                  onChange={(event) => setRecordEmotion(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder={psychCopy.recordBody}
                  value={recordBody}
                  onChange={(event) => setRecordBody(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder={psychCopy.recordAction}
                  value={recordAction}
                  onChange={(event) => setRecordAction(event.target.value)}
                />
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                  placeholder={psychCopy.recordResult}
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
                {psychCopy.recordSave}
              </button>
            </div>
          ) : null}

          <div className="relative mt-6 flex-1 min-h-0">
            <div
              ref={messageListRef}
              onScroll={handleMessageScroll}
            className="h-full space-y-4 overflow-y-auto px-2 pb-2 pt-1"
            >
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const showDayLabel =
                  !previous ||
                  new Date(previous.createdAt).toDateString() !==
                    new Date(message.createdAt).toDateString();
                return (
                  <div key={message.id} className="space-y-3">
                    {showDayLabel ? (
                      <div className="flex justify-center">
                        <span className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-[11px] font-semibold text-[color:var(--ink-500)] shadow-[0_8px_18px_var(--shadow-color)]">
                          {formatDayLabel(message.createdAt)}
                        </span>
                      </div>
                    ) : null}
                    <div
                      className={`flex ${
                        message.authorType === "PSYCHOLOGIST"
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`group relative max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-[0_14px_30px_var(--shadow-color)] ring-1 ring-black/5 ${
                          message.authorType === "PSYCHOLOGIST"
                            ? "bg-[color:var(--accent-500)] text-white"
                            : message.authorType === "AI"
                              ? "border border-emerald-200 bg-emerald-50 text-emerald-900 ring-emerald-200/60"
                              : "bg-[color:var(--surface-100)] text-[color:var(--ink-900)]"
                        }`}
                      >
                        {message.authorType !== "AI" &&
                        message.authorType !== "SYSTEM" &&
                        !message.deletedAt ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(message.id)}
                            className="absolute right-2 top-2 rounded-full border border-black/10 bg-white/80 p-1 text-[color:var(--ink-700)] opacity-0 transition hover:bg-white focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                            aria-label={t.deleteMessage}
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="M6 6l1 14h10l1-14" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                          </button>
                        ) : null}
                        {message.authorType !== "PATIENT" ? (
                          <p className="text-xs uppercase tracking-[0.2em] opacity-70">
                            {message.authorType === "AI"
                              ? t.assistantLabel
                              : message.authorType === "PSYCHOLOGIST"
                                ? psychologistName
                                : message.authorType}
                          </p>
                        ) : null}
                        <div className={message.authorType !== "PATIENT" ? "mt-2" : ""}>
                          {message.deletedAt ? (
                            <p className="italic opacity-70">{t.messageDeleted}</p>
                          ) : (
                            renderFormattedContent(
                              message.authorType === "AI" && typingId === message.id
                                ? message.content.slice(0, typingIndex)
                                : message.content,
                            )
                          )}
                        </div>
                        {message.hasAttachment && !message.deletedAt ? (
                          <div className="mt-3">
                            <AudioMessage
                              src={`/api/messages/attachment?messageId=${message.id}`}
                            />
                          </div>
                        ) : null}
                        <div className="mt-2 text-[10px] text-right text-[color:var(--ink-500)]">
                          {formatTime(message.createdAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {showAiWaiting ? (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-[0_14px_30px_var(--shadow-color)] ring-1 ring-emerald-200/60">
                    <span className="text-xs uppercase tracking-[0.2em] opacity-70">
                      {t.assistantLabel}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-600 [animation-delay:-0.2s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-600 [animation-delay:-0.1s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-600" />
                    </span>
                  </div>
                </div>
              ) : null}
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

          <div className="mt-6 flex flex-col gap-3 border-t border-black/10 pt-4 sm:flex-row sm:items-start">
            {isRecording || pendingAudioBlob ? null : (
              <textarea
                ref={messageInputRef}
                className="min-h-[96px] max-h-[240px] w-full flex-1 resize-none rounded-xl border border-black/10 bg-white/90 px-4 py-3 text-sm"
                placeholder={psychCopy.sendPlaceholder}
                value={messageDraft}
                onChange={(event) => {
                  setMessageDraft(event.target.value);
                  adjustTextareaHeight(event.currentTarget);
                }}
              />
            )}
            <div
              className={`flex gap-3 ${
                pendingAudioBlob || isRecording
                  ? "w-full flex-col items-stretch"
                  : "flex-none items-end justify-end min-w-[88px]"
              }`}
            >
              {isRecording ? (
                <div className="flex w-full flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-[color:var(--ink-500)]">
                    <span>{psychCopy.recording}</span>
                    <span>{formatSeconds(recordSeconds)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
                    <div
                      className="h-full bg-red-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round((recordSeconds / MAX_RECORD_SECONDS) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {pendingAudioUrl ? (
                <div className="flex w-full flex-col gap-2">
                  <audio controls src={pendingAudioUrl} className="w-full" />
                  <div className="flex items-center justify-between text-xs text-[color:var(--ink-500)]">
                    <span>{psychCopy.audioPreview}</span>
                    <span>{formatSeconds(recordSeconds)}</span>
                  </div>
                </div>
              ) : null}
              <div
                className={`flex w-full items-center gap-2 ${
                  pendingAudioBlob || isRecording ? "justify-between" : "justify-end"
                }`}
              >
                {!isRecording && !pendingAudioBlob && !messageDraft.trim() ? (
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-black/10 bg-white/90 text-[color:var(--ink-900)]"
                    type="button"
                    onClick={startRecording}
                    disabled={loading || !selectedId || selectedId === DEMO_CONVERSATION_ID}
                    aria-label="Gravar audio"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z" />
                      <path d="M5 11a7 7 0 0 0 14 0" />
                      <path d="M12 18v3" />
                      <path d="M8 21h8" />
                    </svg>
                  </button>
                ) : null}
                {isRecording ? (
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-white"
                    type="button"
                    onClick={stopRecording}
                    aria-label="Parar gravacao"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  </button>
                ) : null}
                {isRecording || pendingAudioBlob ? (
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-black/10 bg-white/90 text-[color:var(--ink-900)]"
                    type="button"
                    onClick={cancelRecording}
                    aria-label="Descartar audio"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5 text-[color:var(--ink-900)]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M6 6l1 14h10l1-14" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </button>
                ) : null}
                {pendingAudioBlob ? (
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--accent-500)] text-white"
                    type="button"
                    onClick={sendPendingAudio}
                    disabled={loading}
                    aria-label="Enviar audio"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="currentColor"
                    >
                      <path d="M2 21 21 12 2 3v7l13 2-13 2v7Z" />
                    </svg>
                  </button>
                ) : null}
                {!isRecording && !pendingAudioBlob && messageDraft.trim() ? (
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--accent-500)] text-white sm:self-end"
                    type="button"
                    onClick={handleSendMessage}
                    disabled={
                      loading ||
                      !selectedId ||
                      selectedId === DEMO_CONVERSATION_ID ||
                      isRecording
                    }
                    aria-label="Enviar"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="currentColor"
                    >
                      <path d="M2 21 21 12 2 3v7l13 2-13 2v7Z" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>
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
                    {psychCopy.promptTitle}
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
                {psychCopy.promptClose}
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
                  {psychCopy.policyAppliesAll}
                </p>
              </div>
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                type="button"
                onClick={() => setShowPsychPolicy(false)}
              >
                {psychCopy.close}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-black/10 px-6 py-3">
              {[
                { id: "policy", label: psychCopy.tabPolicy },
                { id: "context", label: psychCopy.tabContext },
                { id: "signals", label: psychCopy.tabSignals },
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
                    {psychCopy.promptStructureTitle}
                  </p>
                  <div className="mt-2 space-y-1">
                    <p>{psychCopy.promptStructure1}</p>
                    <p>{psychCopy.promptStructure2}</p>
                    <p>{psychCopy.promptStructure3}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-semibold text-[color:var(--ink-900)]">
                    {psychCopy.policyEditableLabel}
                  </label>
                  <textarea
                    className="min-h-[160px] w-full rounded-2xl border border-black/10 bg-white/90 p-4 text-sm"
                    value={psychPolicy}
                    onChange={(event) => setPsychPolicy(event.target.value)}
                  />
                  <div className="rounded-2xl border border-black/10 bg-white/90 p-4 text-xs text-[color:var(--ink-900)]">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                      {psychCopy.aiTuningTitle}
                    </p>
                    <div className="mt-3 grid gap-4">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-[color:var(--ink-500)]">
                          <span>{psychCopy.maxTokensLabel}</span>
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
                          {psychCopy.maxTurnsLabel}
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
                          disabled={disableEpisodeLimit}
                        />
                      </div>
                      <label className="flex items-center justify-between gap-3 text-[11px] text-[color:var(--ink-500)]">
                        <span>{psychCopy.disableEpisodeLabel}</span>
                        <input
                          type="checkbox"
                          checked={disableEpisodeLimit}
                          onChange={(event) => setDisableEpisodeLimit(event.target.checked)}
                          className="h-4 w-4 accent-[color:var(--accent-500)]"
                        />
                      </label>
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-[color:var(--ink-500)]">
                          <span>{psychCopy.temperatureLabel}</span>
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
                          {psychCopy.resetDefaultLabel}
                        </span>
                        <button
                          type="button"
                          onClick={resetAiSettings}
                          className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-semibold text-[color:var(--ink-900)]"
                        >
                          {psychCopy.resetButton}
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
                      {psychCopy.policySave}
                    </button>
                    <span className="text-xs text-[color:var(--ink-500)]">
                      {autoSaveState === "saving"
                        ? psychCopy.saving
                        : autoSaveState === "saved"
                          ? psychCopy.autoSaved
                          : autoSaveState === "error"
                            ? psychCopy.autoSaveError
                            : psychCopy.policyReview}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-500)]">
                  <p className="font-semibold text-[color:var(--ink-900)]">
                    {psychCopy.conversationPolicyReadOnly}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap">
                    {conversationPolicy.trim()
                      ? conversationPolicy
                      : psychCopy.conversationPolicyEmpty}
                  </p>
                  <p className="mt-2 text-[10px] uppercase tracking-[0.2em]">
                    {psychCopy.conversationPolicyEditHint}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="h-10 rounded-xl border border-black/10 px-4 text-xs font-semibold text-[color:var(--ink-900)]"
                    type="button"
                    onClick={handleOpenPrompt}
                    disabled={promptLoading || !selectedId}
                  >
                    {psychCopy.promptFull}
                  </button>
                </div>

                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-900)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    {psychCopy.directivesTitle}
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-[color:var(--ink-900)]">
                    {localSignals.anger ? (
                      <li>- {psychCopy.directiveAnger}</li>
                    ) : null}
                    {localSignals.disconnect ? (
                      <li>- {psychCopy.directiveDisconnect}</li>
                    ) : null}
                    {localSignals.rumination ? (
                      <li>- {psychCopy.directiveRumination}</li>
                    ) : null}
                    {localSignals.highRisk ? (
                      <li>- {psychCopy.directiveHighRisk}</li>
                    ) : null}
                    {!localSignals.anger &&
                    !localSignals.disconnect &&
                    !localSignals.rumination &&
                    !localSignals.highRisk ? (
                      <li>- {psychCopy.directivesNone}</li>
                    ) : null}
                  </ul>
                </div>
              </div>
            ) : null}

            {psychPolicyTab === "context" ? (
              <div>
                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-900)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    {psychCopy.contextTitle}
                  </p>
                  <div className="mt-3 max-h-[45vh] overflow-y-auto whitespace-pre-wrap">
                    {contextPreview.length ? contextPreview.join("\n\n") : psychCopy.contextEmpty}
                  </div>
                </div>
              </div>
            ) : null}

            {psychPolicyTab === "signals" ? (
              <div className="space-y-3">
                {(Object.keys(uiSignalLabels) as SignalKey[]).map((key) => (
                  <div
                    key={key}
                    className="rounded-2xl border border-black/10 bg-white/90 p-4"
                  >
                    <p className="text-xs font-semibold text-[color:var(--ink-900)]">
                      {uiSignalLabels[key]}
                    </p>
                    <label className="mt-3 block text-[11px] uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                      {psychCopy.keywordsLabel}
                    </label>
                    <input
                      className="mt-2 h-9 w-full rounded-xl border border-black/10 bg-white px-3 text-xs"
                      value={signalConfig[key].keywords.join(", ")}
                      onChange={(event) =>
                        updateSignalKeywords(key, event.target.value)
                      }
                    />
                    <label className="mt-3 block text-[11px] uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                      {psychCopy.directiveLabel}
                    </label>
                    <textarea
                      className="mt-2 min-h-[80px] w-full rounded-xl border border-black/10 bg-white p-3 text-xs"
                      value={signalConfig[key].directive}
                      onChange={(event) =>
                        updateSignalDirective(key, event.target.value)
                      }
                    />
                  </div>
                ))}

                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-900)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    {psychCopy.signalsDetectedTitle}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {localSignals.highRisk ? (
                      <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700">
                        {uiSignalLabels.highRisk}
                      </span>
                    ) : null}
                    {localSignals.anger ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
                        {uiSignalLabels.anger}
                      </span>
                    ) : null}
                    {localSignals.disconnect ? (
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-700">
                        {uiSignalLabels.disconnect}
                      </span>
                    ) : null}
                    {localSignals.rumination ? (
                      <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs text-purple-700">
                        {uiSignalLabels.rumination}
                      </span>
                    ) : null}
                    {!localSignals.highRisk &&
                    !localSignals.anger &&
                    !localSignals.disconnect &&
                    !localSignals.rumination ? (
                      <span className="text-xs text-[color:var(--ink-500)]">
                        {psychCopy.signalsDetectedNone}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-xs text-[color:var(--ink-900)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    {psychCopy.directivesAppliedTitle}
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-[color:var(--ink-900)]">
                    {localSignals.anger ? (
                      <li>- {psychCopy.directiveAnger}</li>
                    ) : null}
                    {localSignals.disconnect ? (
                      <li>- {psychCopy.directiveDisconnect}</li>
                    ) : null}
                    {localSignals.rumination ? (
                      <li>- {psychCopy.directiveRumination}</li>
                    ) : null}
                    {localSignals.highRisk ? (
                      <li>- {psychCopy.directiveHighRisk}</li>
                    ) : null}
                    {!localSignals.anger &&
                    !localSignals.disconnect &&
                    !localSignals.rumination &&
                    !localSignals.highRisk ? (
                      <li>- {psychCopy.directivesNone}</li>
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
                    {psychCopy.saveSignals}
                  </button>
                  <span className="text-xs text-[color:var(--ink-500)]">
                    {loading ? psychCopy.saving : psychCopy.applyPromptHint}
                  </span>
                </div>
              </div>
            ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showInsights ? (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30">
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => setShowInsights(false)}
            aria-label={psychCopy.metricsClose}
          />
          <div className="relative h-full w-full max-w-[420px] overflow-y-auto bg-white/95 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
                  {summaryCopy.title}
                </p>
                <p className="text-lg font-semibold text-[color:var(--ink-900)]">
                  {selectedConversation
                    ? selectedConversation.patient.patientProfile?.displayName ??
                      selectedConversation.patient.email ??
                      "Paciente"
                    : "Selecione uma conversa"}
                </p>
              </div>
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                type="button"
                onClick={() => setShowInsights(false)}
              >
                {psychCopy.metricsClose}
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setInsightTab("summary")}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  insightTab === "summary"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-black/10 bg-white text-[color:var(--ink-900)]"
                }`}
              >
                {summaryCopy.tabs.summary}
              </button>
              <button
                type="button"
                onClick={() => setInsightTab("emotions")}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  insightTab === "emotions"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-black/10 bg-white text-[color:var(--ink-900)]"
                }`}
              >
                {summaryCopy.tabs.emotions}
              </button>
              <button
                type="button"
                onClick={() => setInsightTab("evolution")}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  insightTab === "evolution"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-black/10 bg-white text-[color:var(--ink-900)]"
                }`}
              >
                {summaryCopy.tabs.evolution}
              </button>
            </div>

            {insightTab === "summary" ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    {summaryCopy.weekSelected}
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="h-9 rounded-xl border border-black/10 bg-white px-3 text-xs"
                        value={weeksCount}
                        onChange={(event) => setWeeksCount(Number(event.target.value))}
                      >
                        <option value={4}>{summaryCopy.weeksOptions.four}</option>
                        <option value={8}>{summaryCopy.weeksOptions.eight}</option>
                        <option value={12}>{summaryCopy.weeksOptions.twelve}</option>
                        <option value={16}>{summaryCopy.weeksOptions.sixteen}</option>
                      </select>
                      <button
                        type="button"
                        className="h-9 rounded-xl border border-black/10 px-3 text-xs font-semibold text-[color:var(--ink-900)]"
                        onClick={() =>
                          selectedId
                            ? loadWeeklySummaries(selectedId, { refresh: true })
                            : undefined
                        }
                        disabled={!selectedId}
                      >
                        {summaryCopy.refresh}
                      </button>
                      <button
                        type="button"
                        className="h-9 rounded-xl border border-black/10 px-3 text-xs font-semibold text-[color:var(--ink-900)]"
                        onClick={() => {
                          if (!selectedId) {
                            return;
                          }
                          const url = `/api/insights/weekly/export?conversationId=${selectedId}&weeks=${weeksCount}`;
                          window.open(url, "_blank");
                        }}
                        disabled={!selectedId}
                      >
                        {summaryCopy.exportCsv}
                      </button>
                    </div>
                    <select
                      className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm"
                      value={selectedWeek ?? ""}
                      onChange={(event) => setSelectedWeek(event.target.value)}
                      disabled={weeklySummaries.length === 0}
                    >
                      {weeklySummaries.length === 0 ? (
                        <option value="">{summaryCopy.noData}</option>
                      ) : null}
                      {weeklySummaries.map((item) => {
                        const start = new Date(item.weekStart);
                        const end = new Date(item.weekEnd);
                        return (
                          <option key={item.weekStart} value={item.weekStart}>
                            {formatWeekLabel(start, end)}
                          </option>
                        );
                      })}
                    </select>
                    {selectedSummary ? (
                      <p className="text-xs text-[color:var(--ink-500)]">
                        {summaryCopy.autoGenerated}
                      </p>
                    ) : (
                      <p className="text-xs text-[color:var(--ink-500)]">
                        {summaryCopy.noData}
                      </p>
                    )}
                  </div>
                </div>

                {selectedSummary ? (
                  <>
                    <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                        {summaryCopy.eventsTitle}
                      </p>
                      <div className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
                        {selectedSummary.events.length === 0 ? (
                          <p className="text-xs text-[color:var(--ink-500)]">
                            {summaryCopy.noEvents}
                          </p>
                        ) : (
                          selectedSummary.events.map((event) => (
                            <div key={event.createdAt} className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs">
                              <p className="font-semibold">{event.label}</p>
                              <p className="text-[11px] text-[color:var(--ink-500)]">
                                {new Date(event.createdAt).toLocaleString()}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                        {summaryCopy.changesTitle}
                      </p>
                      <div className="mt-3 grid gap-2 text-xs text-[color:var(--ink-900)]">
                        <div className="flex items-center justify-between rounded-xl border border-black/10 bg-white px-3 py-2">
                          <span>{summaryCopy.messagesLabel}</span>
                          <span>
                            {summaryDeltas ? formatDelta(summaryDeltas.messages) : "0"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-black/10 bg-white px-3 py-2">
                          <span>{summaryCopy.recordsLabel}</span>
                          <span>
                            {summaryDeltas ? formatDelta(summaryDeltas.events) : "0"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-black/10 bg-white px-3 py-2">
                          <span>{summaryCopy.signalsLabel}</span>
                          <span>
                            {summaryDeltas ? formatDelta(summaryDeltas.signals) : "0"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {insightTab === "emotions" ? (
              <div className="mt-5 space-y-4">
                {!selectedSummary ? (
                  <p className="text-xs text-[color:var(--ink-500)]">
                    {summaryCopy.noData}
                  </p>
                ) : (
                  <>
                    <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                        {summaryCopy.emotionsTitle}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedSummary.dominantEmotions.length === 0 ? (
                          <span className="text-xs text-[color:var(--ink-500)]">
                            {summaryCopy.noEmotions}
                          </span>
                        ) : (
                          selectedSummary.dominantEmotions.map((emotion) => (
                            <span
                              key={emotion.label}
                              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-900"
                            >
                              {emotion.label} · {emotion.count}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                        {summaryCopy.signalsTitle}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedSummary.signalsTriggered.length === 0 ? (
                          <span className="text-xs text-[color:var(--ink-500)]">
                            {summaryCopy.noSignals}
                          </span>
                        ) : (
                          selectedSummary.signalsTriggered.map((signal) => (
                            <span
                              key={signal.key}
                              className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900"
                            >
                              {summarySignalLabels[signal.key]} · {signal.count}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {insightTab === "evolution" ? (
              <div className="mt-5 space-y-4">
                {!selectedSummary ? (
                  <p className="text-xs text-[color:var(--ink-500)]">
                    {summaryCopy.noData}
                  </p>
                ) : (
                  <>
                    <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                        {summaryCopy.compareTitle}
                      </p>
                      <div className="mt-3 grid gap-2 text-xs text-[color:var(--ink-900)]">
                        <div className="flex items-center justify-between rounded-xl border border-black/10 bg-white px-3 py-2">
                          <span>{summaryCopy.messagesLabel}</span>
                          <span>
                            {summaryDeltas ? formatDelta(summaryDeltas.messages) : "0"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-black/10 bg-white px-3 py-2">
                          <span>{summaryCopy.recordsLabel}</span>
                          <span>
                            {summaryDeltas ? formatDelta(summaryDeltas.events) : "0"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-black/10 bg-white px-3 py-2">
                          <span>{summaryCopy.signalsLabel}</span>
                          <span>
                            {summaryDeltas ? formatDelta(summaryDeltas.signals) : "0"}
                          </span>
                        </div>
                      </div>
                      {previousSummary ? (
                        <p className="mt-3 text-[11px] text-[color:var(--ink-500)]">
                          {summaryCopy.compareHint}{" "}
                          {new Date(previousSummary.weekStart).toLocaleDateString()}.
                        </p>
                      ) : (
                        <p className="mt-3 text-[11px] text-[color:var(--ink-500)]">
                          {summaryCopy.compareMissing}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

