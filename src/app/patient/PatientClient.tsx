"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGE_OPTIONS, useLanguage } from "@/lib/i18n";
import {
  CHAT_CARD_CLASS,
  CHAT_COMPOSER_CLASS,
  CHAT_GRID_CLASS,
  CHAT_SECTION_CLASS,
} from "@/components/chat/shell";
import { useKeyboardInset } from "@/components/chat/useKeyboardInset";

type ConversationItem = {
  id: string;
  aiEnabled: boolean;
  updatedAt: string;
  psychologist: {
    id: string;
    email: string | null;
    psychologistProfile?: { displayName?: string | null } | null;
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

type Props = {
  tenantId: string;
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

async function postJson<T>(url: string, payload: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
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

export default function PatientClient({ tenantId }: Props) {
  const { language, setLanguage, t } = useLanguage();
  const keyboardInset = useKeyboardInset();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [typingId, setTypingId] = useState<string | null>(null);
  const [typingText, setTypingText] = useState("");
  const [typingIndex, setTypingIndex] = useState(0);
  const typingDoneRef = useRef<Set<string>>(new Set());
  const typingInitializedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
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

  const selectedConversation = useMemo(
    () => conversations.find((conv) => conv.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const locale = language === "pt" ? "pt-BR" : language === "es" ? "es-ES" : "en-US";
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
      return t.chatToday;
    }
    if (diffDays === 1) {
      return t.chatYesterday;
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

  const loadConversations = async () => {
    setLoading(true);
    try {
      const data = await getJson<{ items: ConversationItem[] }>(
        "/api/conversations",
      );
      const items = data.items ?? [];
      setConversations(items);
      if (items.length && !selectedId) {
        setSelectedId(items[0].id);
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

  const handleSelectConversation = async (conversationId: string) => {
    setSelectedId(conversationId);
    shouldAutoScrollRef.current = true;
    setShowScrollToBottom(false);
    setIsMobileMenuOpen(false);
    await loadMessages(conversationId);
  };

  const handleSendMessage = async () => {
    if (!selectedId || !messageDraft.trim()) {
      return;
    }
    const trimmed = messageDraft.trim();
    const optimisticId = `temp-${Date.now()}`;
    const previousMessages = messages;
    try {
      setLoading(true);
      setMessages((current) => [
        ...current,
        {
          id: optimisticId,
          authorType: "PATIENT",
          content: trimmed,
          createdAt: new Date().toISOString(),
        },
      ]);
      shouldAutoScrollRef.current = true;
      await postJson("/api/messages/send", {
        tenantId,
        conversationId: selectedId,
        content: trimmed,
      });
      setMessageDraft("");
      await loadMessages(selectedId, { silent: true });
    } catch (error) {
      setMessages(previousMessages);
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
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
      await loadMessages(selectedId);
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
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(t.patientUnsupportedAudio);
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

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadMessages(selectedId);
    }
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const interval = setInterval(() => {
      loadMessages(selectedId, { silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedId]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container || !shouldAutoScrollRef.current) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!keyboardInset || !shouldAutoScrollRef.current) {
      return;
    }
    const container = messageListRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [keyboardInset]);

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
    <div className="flex flex-col gap-6">
      <div className="rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
            {t.patientListTitle}
          </p>
          <h1 className="mt-2 text-2xl text-[color:var(--ink-900)]">
            {t.patientPortalTitle}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-full border border-black/10 bg-white/90 px-3 text-xs font-semibold text-[color:var(--ink-900)]"
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as typeof language)
              }
              aria-label="Idioma"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {conversations.length === 0 ? (
            <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4 text-sm text-[color:var(--ink-500)]">
              {t.patientNoConversations}
            </div>
          ) : null}

          {conversations.map((conv) => {
            const name =
              conv.psychologist.psychologistProfile?.displayName ??
              conv.psychologist.email ??
              "Psicologa";
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
        </div>
      </div>

      <div className="rounded-[28px] border border-black/10 bg-white/80 p-6 text-sm text-[color:var(--ink-500)]">
        {t.patientWhatsAppHint}
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
    <div className={CHAT_GRID_CLASS}>
      <aside className="hidden lg:flex lg:flex-col lg:gap-6">{asideContent}</aside>

      {isMobileMenuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label={t.commonClose}
          />
          <div className="absolute left-0 top-0 h-full w-[88%] max-w-sm overflow-y-auto bg-[color:var(--surface-100)] p-5 shadow-[0_18px_40px_var(--shadow-color)]">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
                {t.patientMenu}
              </p>
              <button
                type="button"
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {t.commonClose}
              </button>
            </div>
            {asideContent}
          </div>
        </div>
      ) : null}

      <section className={CHAT_SECTION_CLASS}>
        <div className={CHAT_CARD_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
                {t.patientHistoryTag}
              </p>
              <h2 className="text-2xl text-[color:var(--ink-900)]">
                {selectedConversation
                  ? `${t.patientConversationWith} ${
                      selectedConversation.psychologist.psychologistProfile
                        ?.displayName ??
                      selectedConversation.psychologist.email ??
                      t.patientDefaultPsychologist
                    }`
                  : t.patientNoConversation}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--ink-500)]">
              <button
                className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)] lg:hidden"
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
              >
                {t.patientMenu}
              </button>
              <span>
                {selectedConversation?.aiEnabled ? t.patientAiOn : t.patientAiOff}
              </span>
            </div>
          </div>

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
                        message.authorType === "PATIENT"
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`group relative max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-[0_14px_30px_var(--shadow-color)] ring-1 ring-black/5 ${
                          message.authorType === "PATIENT"
                            ? "bg-[color:var(--accent-500)] text-white"
                            : message.authorType === "AI"
                              ? "border border-emerald-200 bg-emerald-50 text-emerald-900 ring-emerald-200/60"
                              : "bg-[color:var(--surface-100)] text-[color:var(--ink-900)]"
                        }`}
                      >
                        {message.authorType === "PATIENT" &&
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
                              : selectedConversation?.psychologist.psychologistProfile
                                  ?.displayName ??
                                selectedConversation?.psychologist.email ??
                                t.patientDefaultPsychologist}
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
                {t.patientScrollBottom}
              </button>
            ) : null}
          </div>

          <div
            className={CHAT_COMPOSER_CLASS}
            style={{
              paddingBottom: `calc(env(safe-area-inset-bottom) + ${keyboardInset}px)`,
            }}
          >
            {isRecording || pendingAudioBlob ? null : (
              <textarea
                ref={messageInputRef}
                className="min-h-[96px] max-h-[240px] w-full flex-1 resize-none rounded-xl border border-black/10 bg-white/90 px-4 py-3 text-sm"
                placeholder={t.patientSendPlaceholder}
                value={messageDraft}
                onChange={(event) => {
                  setMessageDraft(event.target.value);
                  adjustTextareaHeight(event.currentTarget);
                }}
                disabled={!selectedId}
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
                    <span>{t.patientRecording}</span>
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
                    <span>{t.patientAudioPreview}</span>
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
                    disabled={loading || !selectedId}
                    aria-label={t.patientRecordAudioLabel}
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
                {isRecording || pendingAudioBlob ? (
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-black/10 bg-white/90 text-[color:var(--ink-900)]"
                    type="button"
                    onClick={cancelRecording}
                    aria-label={t.patientDiscardAudioLabel}
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
                {isRecording ? (
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-white"
                    type="button"
                    onClick={stopRecording}
                    aria-label={t.patientStopRecordingLabel}
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
                {pendingAudioBlob ? (
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--accent-500)] text-white"
                    type="button"
                    onClick={sendPendingAudio}
                    disabled={loading}
                    aria-label={t.patientSendAudioLabel}
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
                    disabled={loading || !selectedId || isRecording}
                    aria-label={t.patientSend}
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
            {loading ? t.loading : status}
          </div>
        ) : null}
      </section>
    </div>
  );
}
