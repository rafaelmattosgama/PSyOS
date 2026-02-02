"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGE_OPTIONS, useLanguage } from "@/lib/i18n";

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
};

type Props = {
  tenantId: string;
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
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const selectedConversation = useMemo(
    () => conversations.find((conv) => conv.id === selectedId) ?? null,
    [conversations, selectedId],
  );

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
    try {
      setLoading(true);
      await postJson("/api/messages/send", {
        tenantId,
        conversationId: selectedId,
        content: messageDraft.trim(),
      });
      setMessageDraft("");
      await loadMessages(selectedId);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadMessages(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const interval = setInterval(() => {
      loadMessages(selectedId, { silent: true });
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
    <div className="flex flex-col gap-6">
      <div className="rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
              {t.patientListTitle}
            </p>
            <h1 className="mt-2 text-2xl text-[color:var(--ink-900)]">
              {t.patientPortalTitle}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-full border border-black/10 bg-white/80 px-3 text-xs font-semibold text-[color:var(--ink-900)]"
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
            <button
              className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[color:var(--ink-900)]"
              type="button"
              onClick={loadConversations}
            >
              {t.patientUpdated}
            </button>
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
    <div className="mx-auto grid w-full gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="hidden lg:flex lg:flex-col lg:gap-6">{asideContent}</aside>

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
                Menu
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
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.authorType === "PATIENT"
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <div
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-[0_14px_30px_var(--shadow-color)] ring-1 ring-black/5 ${
                    message.authorType === "PATIENT"
                      ? "bg-[color:var(--accent-500)] text-white"
                      : message.authorType === "AI"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-900 ring-emerald-200/60"
                        : "bg-[color:var(--surface-100)] text-[color:var(--ink-900)]"
                  }`}
                >
                    <p className="text-xs uppercase tracking-[0.2em] opacity-70">
                      {message.authorType === "PATIENT"
                        ? t.patientYou
                        : message.authorType}
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
                {t.patientScrollBottom}
              </button>
            ) : null}
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-black/10 pt-4 sm:flex-row">
            <textarea
              ref={messageInputRef}
              className="min-h-[96px] max-h-[240px] flex-1 resize-none rounded-xl border border-black/10 bg-white/90 px-4 py-3 text-sm"
              placeholder={t.patientSendPlaceholder}
              value={messageDraft}
              onChange={(event) => {
                setMessageDraft(event.target.value);
                adjustTextareaHeight(event.currentTarget);
              }}
              disabled={!selectedId}
            />
            <button
              className="h-12 rounded-xl bg-[color:var(--accent-500)] px-6 text-sm font-semibold text-white sm:self-end"
              type="button"
              onClick={handleSendMessage}
              disabled={loading || !selectedId}
            >
              {t.patientSend}
            </button>
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
