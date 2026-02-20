import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StopCircle, Send, Trash2, Save, Bot, BrainCircuit, User, ShieldAlert, ChevronDown, Cloud, Cpu, RefreshCw, Copy, Check } from 'lucide-react';
import { marked } from 'marked';
import { getBackendBaseUrl } from '../utils/backendUrl';

marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
});

const ROLE_SUGGESTED_QUESTIONS = {
    combustion_dynamics_expert: [
        "Which signals indicate flame acceleration or DDT risk in this dataset?",
        "How should I interpret pressure-wave and flame-front coupling here?",
        "What additional plots would improve combustion regime diagnosis?"
    ],
    dispersion_cfd_expert: [
        "Which CFD boundary conditions are most critical for this case?",
        "How can I validate this simulation against my experimental pressure data?",
        "What mesh/turbulence checks should I run before calibration?"
    ],
    experimental_instrumentation_analyst: [
        "Do these channels look correctly assigned for pressure vs trigger?",
        "What QA/QC checks should I run before pressure analysis?",
        "How can I reduce instrumentation uncertainty in this setup?"
    ],
    risk_safety_engineer: [
        "What are the top safety risks implied by this scenario?",
        "Which mitigation measures should be prioritized first?",
        "How should I structure a safety-case argument from this evidence?"
    ],
    structural_analyst: [
        "What load/impulse metrics matter most for enclosure integrity?",
        "How can I estimate structural demand from this pressure trace?",
        "Which structural checks should I add to this workflow?"
    ],
    literature_reviewer: [
        "Summarize key papers most relevant to this analysis task.",
        "Where does current literature disagree on these findings?",
        "What research gaps can this project target next?"
    ],
    regulatory_specialist: [
        "Which standards are most relevant for this test configuration?",
        "What compliance evidence should I document in the report?",
        "Where might this workflow conflict with ISO/IEC/NFPA expectations?"
    ],
    thesis_advisor: [
        "How can I strengthen the methodology section for this analysis?",
        "What are likely reviewer criticisms and how do I address them?",
        "How should results be structured for a strong thesis narrative?"
    ],
    project_coordinator: [
        "What are the next 3 milestones to keep this project on schedule?",
        "Which dependencies or risks could delay the current plan?",
        "How should tasks be split across the team this week?"
    ],
    computational_it_engineer: [
        "Where in the app is EWT calculated and how does data flow end-to-end?",
        "What refactor would most improve maintainability without breaking behavior?",
        "Which performance bottlenecks should we prioritize in this pipeline?"
    ],
};

/**
 * AiRAPage Component - PhD Research Assistant Context Enhancement
 * Incorporates experimental objectives and investigator metadata into the streaming request.
 * * @param {string} projectPath - Current system path
 * @param {Array} chatHistory - Global chat state
 * @param {Function} setChatHistory - State setter
 * @param {Object} planMeta - Metadata from TabPlan (objective/description)
 * @param {Object} checklistState - Sign-off data from TabChecklist (resp_name/inst_init)
 */
const AiRAPage = ({ projectPath, chatHistory = [], setChatHistory, planMeta = {}, checklistState = {} }) => {
    const apiBaseUrl = getBackendBaseUrl();
    const [query, setQuery] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [models, setModels] = useState(['deepseek-v3.1:671b-cloud']);
    const [selectedModel, setSelectedModel] = useState('deepseek-v3.1:671b-cloud');
    const [copiedIndex, setCopiedIndex] = useState(null);
    const [isAtBottom, setIsAtBottom] = useState(true);
    // Multi-Agent mode state
    const [_multiAgentMode, _setMultiAgentMode] = useState(false);
    const [_multiAgentModels, _setMultiAgentModels] = useState([
        'deepseek-v3.1:671b-cloud',
        'deepseek-v3.1:671b-cloud',
        'deepseek-v3.1:671b-cloud',
    ]);
    const [aiStatus, setAiStatus] = useState('unknown');
    const [appContext, setAppContext] = useState('');
    const [hasRepoContextSnapshot, setHasRepoContextSnapshot] = useState(false);
    const eventSourceRef = useRef(null);
    const scrollRef = useRef(null);
    const queryRef = useRef(null);
    const streamBufferRef = useRef('');
    const flushTimerRef = useRef(null);
    const [renderedCache] = useState(() => new Map());
    const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';

    const flushStreamBuffer = useCallback(() => {
        flushTimerRef.current = null;
        const nextContent = streamBufferRef.current;
        setChatHistory(prev => {
            if (!prev.length) return prev;
            const next = [...prev];
            const lastIdx = next.length - 1;
            const last = next[lastIdx];
            if (last?.role === 'ai') {
                next[lastIdx] = { ...last, content: nextContent };
            }
            return next;
        });
    }, [setChatHistory]);

    const scheduleStreamFlush = useCallback(() => {
        if (flushTimerRef.current) return;
        flushTimerRef.current = window.setTimeout(() => {
            flushStreamBuffer();
        }, 80);
    }, [flushStreamBuffer]);

    const stopStreaming = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (flushTimerRef.current) {
            window.clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        setIsGenerating(false);
    }, []);

    const checkAiConnection = useCallback(() => {
        if (demoMode) {
            setAiStatus('disabled');
            return;
        }
        fetch(`${apiBaseUrl}/get_models`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setModels(data.models);
                    setAiStatus('online');
                } else {
                    setAiStatus('offline');
                }
            })
            .catch(() => setAiStatus('offline'));
    }, [apiBaseUrl, demoMode]);

    // Fetch models for the dropdown
    useEffect(() => {
        const timer = window.setTimeout(() => {
            checkAiConnection();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [checkAiConnection]);

    useEffect(() => {
        let cancelled = false;
        const loadAppContext = async () => {
            if (demoMode) {
                if (!cancelled) {
                    setAppContext('');
                    setHasRepoContextSnapshot(false);
                }
                return;
            }
            const parts = [];
            if (!projectPath) {
                try {
                    const res = await fetch(`${apiBaseUrl}/projects_overview`);
                    const data = await res.json();
                    if (data.success && data.overview) {
                        parts.push(data.overview);
                    }
                } catch {
                    // keep running; repo context can still be loaded below
                }
            }
            try {
                const repoRes = await fetch(`${apiBaseUrl}/app_repo_context`);
                const repoData = await repoRes.json();
                if (repoData.success && repoData.context) {
                    parts.push(repoData.context);
                    if (!cancelled) setHasRepoContextSnapshot(true);
                } else if (!cancelled) {
                    setHasRepoContextSnapshot(false);
                }
            } catch {
                if (!cancelled) setHasRepoContextSnapshot(false);
            }
            if (!cancelled) {
                setAppContext(parts.join('\n\n'));
            }
        };
        loadAppContext();
        return () => {
            cancelled = true;
        };
    }, [apiBaseUrl, demoMode, projectPath]);

    const scrollToBottom = () => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    };

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return undefined;
        const handleScroll = () => {
            const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
            setIsAtBottom(distance < 80);
        };
        handleScroll();
        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // Auto-scroll logic (only if user is already near the bottom)
    useEffect(() => {
        if (isAtBottom) scrollToBottom();
    }, [chatHistory, isAtBottom]);

    useEffect(() => () => stopStreaming(), [stopStreaming]);

    const EXPERT_ROLES = [
        "combustion_dynamics_expert",
        "dispersion_cfd_expert",
        "experimental_instrumentation_analyst",
        "risk_safety_engineer",
        "structural_analyst",
        "literature_reviewer",
        "regulatory_specialist",
        "thesis_advisor",
        "project_coordinator",
        "computational_it_engineer"
    ];
    const [selectedExpert, setSelectedExpert] = useState(EXPERT_ROLES[0]);
    const [activatedExperts, setActivatedExperts] = useState([EXPERT_ROLES[0]]);
    const suggestedQuestions = ROLE_SUGGESTED_QUESTIONS[selectedExpert] || [];

    const formatAiContent = useCallback((content) => {
        if (!content) return '';
        const normalizeLists = (segment) => {
            let text = segment.replace(/\r\n/g, '\n');

            // Remove excessive indentation or tabs that can force markdown code blocks.
            text = text.replace(/\t/g, ' ');
            text = text.replace(/^\s{2,}(?=\S)/gm, '');

            // Force newlines before inline bullet markers.
            text = text.replace(/([^\n])\s*\*(?=(Books|Papers|Standards)\/)/gi, '$1\n*');
            text = text.replace(/([^\n])\s*(Books|Papers|Standards)\//gi, '$1\n$2/');
            text = text.replace(/([^\n])\s*\*\s+(?=\S)/g, '$1\n* ');
            text = text.replace(/([^\n])\s*-\s+(?=\S)/g, '$1\n- ');
            text = text.replace(/([^\n])\s*(\d+\.)\s+(?=\S)/g, '$1\n$2 ');
            text = text.replace(/(^|\n)\s*[*•]\s*(?=\S)/g, '$1- ');
            text = text.replace(/(^|\n)\s*-\s*(?=\S)/g, '$1- ');

            // Ensure section labels like "Available Resources:" sit on their own line.
            text = text.replace(/Available Resources:\s*/gi, 'Available Resources:\n');

            const lines = text.split('\n');
            const output = [];
            let inList = false;
            let lastListIndex = -1;

            const pdfRegex = /(Books|Papers|Standards)\/[^\n]+?\.pdf/g;
            const formatPdfItem = (value) => (
                value.replace(pdfRegex, (match) => {
                    const [category, ...restParts] = match.split('/');
                    const rest = restParts.join('/');
                    return `<strong><span class="ai-category">${category}</span>/${rest}</strong>`;
                })
            );

            for (const rawLine of lines) {
                const trimmed = rawLine.trim();

                if (!trimmed) {
                    output.push('');
                    inList = false;
                    lastListIndex = -1;
                    continue;
                }

                const indent = rawLine.match(/^\s*/)?.[0]?.length ?? 0;
                const listMatch = trimmed.match(/^([*-])\s*(.+)$/);
                const numMatch = trimmed.match(/^(\d+)\.\s*(.+)$/);

                if (listMatch) {
                    const bullet = indent >= 2 ? '  - ' : '- ';
                    output.push(`${bullet}${formatPdfItem(listMatch[2].trim())}`);
                    inList = true;
                    lastListIndex = output.length - 1;
                    continue;
                }

                if (numMatch) {
                    output.push(`${numMatch[1]}. ${formatPdfItem(numMatch[2].trim())}`);
                    inList = true;
                    lastListIndex = output.length - 1;
                    continue;
                }

                if (/^(Books|Papers|Standards)\//i.test(trimmed)) {
                    output.push(`- ${formatPdfItem(trimmed)}`);
                    inList = true;
                    lastListIndex = output.length - 1;
                    continue;
                }

                const pdfMatches = [...trimmed.matchAll(pdfRegex)].map((match) => match[0]);
                if (pdfMatches.length > 0) {
                    const leading = trimmed.split(pdfMatches[0])[0].trim();
                    if (leading) output.push(leading);
                    pdfMatches.forEach((item) => output.push(`- ${formatPdfItem(item)}`));
                    inList = true;
                    lastListIndex = output.length - 1;
                    continue;
                }

                if (inList && lastListIndex >= 0) {
                    const prevItem = output[lastListIndex] || '';
                    const prevIsPdf = /\.pdf/i.test(prevItem);
                    const isContinuation = rawLine.startsWith(' ') || /^[a-z(]/.test(trimmed) || (prevIsPdf && /^[A-Z]/.test(trimmed));
                    if (isContinuation) {
                        const joiner = prevIsPdf ? '<br/>' : ' ';
                        output[lastListIndex] = `${output[lastListIndex]}${joiner}${formatPdfItem(trimmed)}`;
                        continue;
                    }
                    if (!isContinuation) {
                        output.push(`  - ${trimmed}`);
                        lastListIndex = output.length - 1;
                        continue;
                    }
                }

                output.push(formatPdfItem(trimmed));
                inList = false;
                lastListIndex = -1;
            }

            return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        };
        const parts = content.split('```');
        return parts.map((part, index) => (index % 2 === 1 ? part : normalizeLists(part))).join('```');
    }, []);

    const getMessageHtml = useCallback((msg, isLastMessage) => {
        const rawContent = msg.content || (isGenerating && isLastMessage ? '...' : '');
        const cacheKey = `${msg.role}::${rawContent}`;
        const cache = renderedCache;
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        const normalized = msg.role === 'user' ? rawContent : formatAiContent(rawContent);
        const html = marked.parse(normalized);
        cache.set(cacheKey, html);
        if (cache.size > 600) {
            const firstKey = cache.keys().next().value;
            if (firstKey) cache.delete(firstKey);
        }
        return html;
    }, [formatAiContent, isGenerating, renderedCache]);

    const formatTime = (value) => {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const handleCopy = async (text, index) => {
        if (!text) return;
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const temp = document.createElement('textarea');
                temp.value = text;
                temp.style.position = 'fixed';
                temp.style.opacity = '0';
                document.body.appendChild(temp);
                temp.focus();
                temp.select();
                document.execCommand('copy');
                document.body.removeChild(temp);
            }
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 1500);
        } catch {
            alert('Copy failed');
        }
    };

    /**
     * handleAsk
     * Sends the query to the Python backend with injected experimental context.
     */
const handleAsk = () => {
        if (!query || isGenerating) return;
        if (demoMode) {
            setChatHistory(prev => [
                ...prev,
                { role: 'ai', content: 'AiRA is disabled in this demo build.', timestamp: Date.now() }
            ]);
            setQuery('');
            return;
        }
        const currentQuery = query;
        setQuery('');
        setIsGenerating(true);

        setChatHistory(prev => [
            ...prev, 
            { role: 'user', content: currentQuery, timestamp: Date.now() }, 
            { role: 'ai', content: '', model: selectedModel, timestamp: Date.now() }
        ]);

        // Close any stale stream/timer without changing the current generation flag.
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (flushTimerRef.current) {
            window.clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }

        // Use URLSearchParams to safely encode context data
        const contextParams = new URLSearchParams();
        contextParams.set('query', currentQuery);
        contextParams.set('projectPath', projectPath);
        contextParams.set('model', selectedModel);
        contextParams.set('investigator', checklistState?.resp_name || 'N/A');
        contextParams.set('institution', checklistState?.inst_init || 'N/A');
        contextParams.set('objective', planMeta?.objective || 'N/A');
        contextParams.set('plan_desc', planMeta?.description || 'N/A');
        contextParams.set('app_context', appContext || '');
        contextParams.set('include_repo_context', hasRepoContextSnapshot ? '0' : '1');
        contextParams.set('expert_role', selectedExpert);
        activatedExperts.forEach(role => contextParams.append('expert_roles', role));

        const url = `${apiBaseUrl}/ai_research_stream?${contextParams.toString()}`;
        const es = new EventSource(url);
        eventSourceRef.current = es;
        streamBufferRef.current = '';
        es.onmessage = (event) => {
            if (event.data.includes("[Thinking Time:")) return;
            streamBufferRef.current += event.data;
            scheduleStreamFlush();
        };
        es.onerror = () => {
            stopStreaming();
        };
    };

    const saveChat = async () => {
        if (!chatHistory || chatHistory.length === 0) return;
        try {
            const res = await fetch(`${apiBaseUrl}/save_ai_chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectPath, history: chatHistory })
            });
            const d = await res.json();
            if (d.success) alert("EXDA Session saved to aiChat folder.");
        } catch { alert("Save failed: Backend error"); }
    };

    return (
        <div className="flex flex-col h-[75vh] bg-background p-2 animate-in fade-in duration-300 font-sans">
            {demoMode && (
                <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-semibold text-amber-300">
                    AiRA is disabled in this demo build. The rest of the dashboard is fully functional.
                </div>
            )}

            <div ref={scrollRef} className="relative flex-grow overflow-y-auto bg-card/20 border border-border/40 rounded-xl p-6 mb-4 custom-scrollbar">
                {chatHistory.length > 0 ? (
                    <div className="space-y-6 text-sm text-foreground/80">
                        {chatHistory.map((msg, idx) => {
                            const isUser = msg.role === 'user';
                            const timeLabel = formatTime(msg.timestamp);
                            const isLastMessage = idx === chatHistory.length - 1;
                            const displayHtml = getMessageHtml(msg, isLastMessage);
                            return (
                            <div key={idx} className={`flex gap-4 mb-6 ${isUser ? 'justify-end' : ''}`}>
                                {/* AVATAR COLUMN */}
                                <div className="mt-1 shrink-0">
                                    {msg.role === 'user' ? 
                                        <User size={14} className="text-muted-foreground" /> : 
                                        <BrainCircuit size={14} className="text-primary/70" />
                                    }
                                </div>

                                {/* CONTENT COLUMN */}
                                <div className={`min-w-0 ${isUser ? 'max-w-[70%]' : 'max-w-[78%]'} w-full`}>
                                    <div className="mb-2 flex items-center justify-between gap-3 text-[9px] uppercase tracking-widest text-muted-foreground">
                                        <div className="flex items-center gap-2">
                                            <span className={`rounded-md border px-2 py-0.5 font-semibold ${isUser ? 'border-border/50 bg-muted/40 text-foreground' : 'border-primary/30 bg-primary/10 text-primary'}`}>
                                                {isUser ? 'You' : 'AiRA'}
                                            </span>
                                            {timeLabel && <span className="opacity-70">{timeLabel}</span>}
                                        </div>
                                        {!isUser && (
                                            <button
                                                onClick={() => handleCopy(msg.content, idx)}
                                                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[9px] font-semibold text-muted-foreground hover:text-foreground hover:border-ring transition"
                                                title="Copy response"
                                            >
                                                {copiedIndex === idx ? <Check size={10} /> : <Copy size={10} />}
                                                {copiedIndex === idx ? 'Copied' : 'Copy'}
                                            </button>
                                        )}
                                    </div>
                                    {/* We use "markdown-content" class here to link to our custom CSS. 
                                    We REMOVED "whitespace-pre-wrap" because "marked" handles the line breaks for lists automatically. 
                                    */}
                                    <div 
                                        className={`markdown-content max-w-none rounded-xl border px-4 py-3 shadow-sm ${
                                            isUser
                                                ? 'bg-muted/40 border-border/40 text-foreground'
                                                : 'bg-card/70 border-primary/20 text-foreground/90 ai-response-container'
                                        }`}
                                        dangerouslySetInnerHTML={{ __html: displayHtml }} 
                                    />
                                    
                                    {msg.model && (
                                        <div className="text-[8px] text-muted-foreground mt-2 font-mono uppercase tracking-widest opacity-60">
                                            processed via {msg.model}
                                        </div>
                                    )}
                                </div>
                            </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center opacity-10 text-muted-foreground text-[10px] font-bold tracking-[0.5em]">AiRA Standby</div>
                )}
                {!isAtBottom && (
                    <button
                        onClick={scrollToBottom}
                        className="sticky bottom-4 ml-auto mr-2 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shadow-lg backdrop-blur hover:text-foreground hover:border-ring transition"
                        title="Jump to latest"
                    >
                        <ChevronDown size={12} />
                        Latest
                    </button>
                )}
            </div>

            <div className="bg-card/60 border border-border/40 rounded-xl p-2 shadow-inner">
                <textarea ref={queryRef} className="w-full bg-transparent p-3 text-sm text-foreground outline-none resize-none min-h-[80px]" placeholder="Analyze simulation parameters or safety docs..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAsk())} />
                {!!suggestedQuestions.length && (
                    <div className="px-3 pb-2 flex flex-wrap gap-2">
                        {suggestedQuestions.map((question, idx) => (
                            <button
                                key={`${selectedExpert}-q-${idx}`}
                                type="button"
                                onClick={() => {
                                    setQuery(question);
                                    queryRef.current?.focus();
                                }}
                                className="text-[10px] rounded-md border border-border bg-muted/40 px-2 py-1 text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
                            >
                                {question}
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-t border-border/30">
                    <div className="flex items-center gap-1">
                        <button onClick={() => { renderedCache.clear(); setChatHistory([]); }} className="p-2 text-muted-foreground hover:text-red-400 transition-colors" title="Clear History"><Trash2 size={15}/></button>
                        <button onClick={saveChat} className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Save Session"><Save size={15}/></button>
                        <div className={`ml-1 flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${aiStatus === 'online' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : aiStatus === 'offline' ? 'bg-red-500/10 text-red-400 border-red-500/20' : aiStatus === 'disabled' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-muted/50 text-muted-foreground border-border'}`}>
                            <ShieldAlert size={10} /> {aiStatus === 'online' ? 'AI Online' : aiStatus === 'offline' ? 'AI Offline' : aiStatus === 'disabled' ? 'AI Disabled' : 'AI Status'}
                        </div>
                        {/* Multi-Agent Toggle (commented out, not in use)
                        <div className="flex items-center ml-2">
                            <label className="flex items-center gap-1 cursor-pointer text-[10px]">
                                <input
                                    type="checkbox"
                                    checked={multiAgentMode}
                                    onChange={e => setMultiAgentMode(e.target.checked)}
                                    className="accent-blue-500"
                                />
                                Multi-Agent
                            </label>
                        </div>
                        */}
                        <div className="ml-2 flex items-center gap-2">
                            <label className="text-[10px]">Expert Role:</label>
                            <select
                                value={selectedExpert}
                                onChange={e => setSelectedExpert(e.target.value)}
                                className="appearance-none bg-card/60 border border-border text-[9px] text-muted-foreground pl-2 pr-6 py-0.5 rounded outline-none cursor-pointer hover:border-ring transition-colors"
                            >
                                {EXPERT_ROLES.map(role => <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>)}
                            </select>
                            <button
                                className={`ml-2 px-2 py-1 rounded text-[9px] font-bold border border-border bg-muted/60 text-muted-foreground hover:bg-muted/80 transition-colors ${activatedExperts.includes(selectedExpert) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                onClick={() => {
                                    if (!activatedExperts.includes(selectedExpert)) {
                                        setActivatedExperts([...activatedExperts, selectedExpert]);
                                    }
                                }}
                                disabled={activatedExperts.includes(selectedExpert)}
                            >Activate</button>
                            <div className="flex gap-1 ml-2">
                                {activatedExperts.map(role => (
                                    <span
                                        key={role}
                                        className="px-2 py-1 rounded text-[9px] font-bold border border-primary/30 bg-primary/10 text-primary cursor-pointer"
                                        title="Double-click to deactivate"
                                        onDoubleClick={() => setActivatedExperts(activatedExperts.filter(r => r !== role))}
                                    >
                                        {role.replace(/_/g, ' ')}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div className="ml-2 flex items-center gap-2">
                            <label className="text-[10px]">Model:</label>
                            <select
                                value={selectedModel}
                                onChange={e => setSelectedModel(e.target.value)}
                                className="appearance-none bg-card/60 border border-border text-[9px] text-muted-foreground pl-2 pr-6 py-0.5 rounded outline-none cursor-pointer hover:border-ring transition-colors"
                            >
                                {models.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <ChevronDown size={10} className="absolute right-1 text-muted-foreground pointer-events-none" />
                        </div>
                        <button
                            onClick={checkAiConnection}
                            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
                            title="Retry AI connection"
                            aria-label="Retry AI connection"
                        >
                            <RefreshCw size={12} />
                        </button>
                        <div className="ml-2 hidden md:flex items-center gap-2 text-[9px] uppercase tracking-widest">
                            <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-primary">
                                <Cloud size={10} /> Cloud‑Powered
                            </span>
                        </div>
                    </div>
                    {isGenerating ? (
                        <button onClick={stopStreaming} className="p-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-all">
                            <StopCircle size={18} />
                        </button>
                    ) : (
                        <button onClick={handleAsk} disabled={!query || demoMode} className="p-2 bg-primary/90 text-primary-foreground rounded-lg hover:bg-primary transition-all disabled:opacity-20 disabled:cursor-not-allowed">
                            <Send size={18} className="text-white" />
                        </button>
                    )}
                </div>
                <div className="px-3 pb-3 text-[10px] text-muted-foreground">
                    AiRA can make mistakes. Check important info.
                </div>
            </div>
        </div>
    );
};

export default AiRAPage;
