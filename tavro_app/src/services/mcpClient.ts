import { AgentData } from '../types/agent';
import { UseCaseSummary, UseCaseDetail } from '../types/useCase';
import { appLogger } from './logger';
import { getLLMConfig, ChatMessage, LLMConfig } from './llmService';
import { copilotOrchestrator } from './llm/copilotOrchestrator';
import type { ToolDefinition } from './llm/types';
import { isAccessTokenExpired, refreshAccessToken } from './auth';

type ChatViewContext = {
    viewType?: string;
    viewData?: any;
    /** Pre-built system prompt from buildSystemPrompt() — takes precedence over default */
    systemPrompt?: string;
};

type UseCaseActionFields = {
    title?: string;
    description?: string;
    business_problem_statement?: string;
    expected_benefits?: string;
    priority?: string;
    regulatory_impact?: string[];
    solution_approach?: string;
    use_case_owner?: string;
    impacted_business_applications?: string[];
    impacted_business_processes?: string[];
};

function getRiskLevel(agent: AgentData): 'high' | 'medium' | 'low' {
    const labels = [
        agent.risk_assessment?.blended_risk_classification,
        agent.risk_assessment?.regulatory_risk_classification,
        (agent as any).latest_risk_class,
        (agent as any).blended_risk_classification,
        (agent as any).risk_classification,
    ].filter(Boolean).map(v => String(v).toLowerCase().trim());
    if (labels.some(v => v.includes('prohibited') || v.includes('high risk') || v === 'high' || v.includes('critical'))) return 'high';
    if (labels.some(v => v.includes('other') || v.includes('low'))) return 'low';

    const apps = agent.application ?? [];
    if (apps.some(a =>
        a.business_criticality?.toLowerCase().includes('high') ||
        a.business_criticality?.toLowerCase().includes('critical') ||
        a.emergency_tier?.toLowerCase().includes('critical') ||
        a.emergency_tier?.toLowerCase().includes('mission critical')
    )) return 'high';
    if (apps.some(a =>
        a.business_criticality?.toLowerCase().includes('medium') ||
        a.emergency_tier?.toLowerCase().includes('business critical')
    )) return 'medium';
    return 'low';
}

function buildEnvSummary(environment: string, agents: AgentData[]) {
    const counts = agents.reduce(
        (acc, agent) => { acc[getRiskLevel(agent)]++; return acc; },
        { high: 0, medium: 0, low: 0 }
    );
    return { environment, count: agents.length, ...counts, icon: null };
}

function unwrapToolResponse(data: any, keys: string[]): any {
    let current = data;
    if (Array.isArray(current)) current = current[0];
    if (!current) return current;
    for (const key of keys) {
        if (current[key]) {
            current = current[key];
            break;
        }
    }
    if (Array.isArray(current)) current = current[0];
    return current;
}

function extractRiskFromSummaryText(summary: any): string | undefined {
    const text = String(summary ?? '').toLowerCase();
    if (!text) return undefined;
    if (text.includes('risk classification:') && text.includes('prohibited')) return 'Prohibited';
    if (text.includes('risk classification:') && text.includes('high risk')) return 'High Risk';
    if (text.includes('risk classification:') && (text.includes('medium risk') || text.includes('moderate'))) return 'Medium';
    if (text.includes('risk classification:') && (text.includes('other') || text.includes('low risk'))) return 'Other';
    if (text.includes('designated as') && text.includes('prohibited')) return 'Prohibited';
    if (text.includes('designated as') && text.includes('high risk')) return 'High Risk';
    if (text.includes('designated as') && (text.includes('medium risk') || text.includes('moderate'))) return 'Medium';
    if (text.includes('designated as') && (text.includes('other') || text.includes('low risk'))) return 'Other';
    return undefined;
}

function normalizeRiskAssessment(item: any): any {
    const summary =
        item.risk_assessment?.summary ??
        item.risk_assessment?.risk_summary ??
        item.risk_summary ??
        item.summary ??
        item.risk_assessment_summary ??
        item.ai_risk_summary;

    const parsedFromSummary = extractRiskFromSummaryText(summary);

    return {
        ...(item.risk_assessment ?? {}),
        blended_risk_classification:
            item.risk_assessment?.blended_risk_classification ??
            item.blended_risk_classification ??
            item.overall_risk_classification ??
            item.eu_ai_act_risk_classification ??
            item.latest_risk_class ??
            item.risk_classification ??
            parsedFromSummary,
        blended_risk_score:
            item.risk_assessment?.blended_risk_score ??
            item.blended_risk_score ??
            item.risk_score ??
            item.overall_risk_score,
        regulatory_risk_classification:
            item.risk_assessment?.regulatory_risk_classification ??
            item.regulatory_risk_classification ??
            item.regulatory_risk_class ??
            item.eu_ai_act_risk_classification,
        regulatory_risk_score:
            item.risk_assessment?.regulatory_risk_score ??
            item.regulatory_risk_score,
        aivss_score:
            item.risk_assessment?.aivss_score ??
            item.aivss_score,
        summary,
    };
}

function normaliseUseCase(raw: any): any {
    if (!raw) return raw;
    return Object.assign({}, raw, {
        id: raw.id ?? raw.use_case_id ?? raw.identifier ?? raw.number,
        identifier: raw.identifier ?? raw.use_case_id ?? raw.number ?? raw.id,
        name: raw.name ?? raw.title ?? raw.use_case_name,
        description: raw.description ?? raw.short_description ?? raw.summary,
        status: raw.status ?? raw.state ?? raw.workflow_state,
        owner: raw.owner ?? raw.use_case_owner ?? raw.assigned_to,
        proposed_by: raw.proposed_by ?? raw.requested_by ?? raw.opened_by,
        function: raw['function'] ?? raw.business_function ?? raw.category,
        priority: raw.priority ?? raw.agent_risk_tier_art ?? raw.risk_tier,
        problem_statement: raw.problem_statement ?? raw.business_problem ?? raw.problem,
        expected_benefits: raw.expected_benefits ?? raw.benefits ?? raw.justification,
        solution_approach: raw.solution_approach ?? raw.proposed_solution ?? raw.approach,
        business_sponsors: raw.business_sponsors ?? raw.sponsor ?? raw.stakeholders,
        use_case_type: raw.use_case_type ?? raw.type ?? raw.category_type,
        overall_risk: raw.overall_risk ?? raw.overall_risk_classification ?? raw.risk_classification,
        tag: raw.tag ?? raw.tags,
        agents: raw.agents ?? raw.of_associated_agents ?? raw.agent_cards ?? raw.ai_agents,
        applications: raw.applications ?? raw.of_associated_applications ?? raw.application ?? raw.apps,
        business_processes: raw.business_processes ?? raw.of_associated_business_processes ?? raw.of_associated_processes ?? raw.processes ?? raw.business_process,
        controls: raw.controls ?? raw.of_associated_controls ?? raw.control_list ?? raw.control,
        risk_assessments: raw.risk_assessments ?? raw.of_associated_risk_assessments ?? raw.risk_assessment ?? raw.assessments,
    });
}

function extractLabeledValue(text: string, labels: string[]): string | undefined {
    const escaped = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const match = text.match(new RegExp(`(?:^|\\n|[,;])\\s*(?:${escaped})\\s*[:=-]\\s*([^\\n;]+)`, 'i'));
    return match?.[1]?.trim().replace(/^["']|["']$/g, '');
}

function extractListValue(text: string, labels: string[]): string[] | undefined {
    const value = extractLabeledValue(text, labels);
    if (!value) return undefined;
    return value.split(/[,|]/).map(item => item.trim()).filter(Boolean);
}

function extractQuotedAfter(text: string, verbs: string[]): string | undefined {
    const verbPattern = verbs.join('|');
    const quoted = text.match(new RegExp(`(?:${verbPattern})[^"']*["']([^"']+)["']`, 'i'));
    if (quoted?.[1]) return quoted[1].trim();
    const named = text.match(new RegExp(`(?:${verbPattern}).*?(?:called|named|titled)\\s+([^.,;\\n]+)`, 'i'));
    return named?.[1]?.trim();
}

function parseUseCaseActionFields(userMessage: string): UseCaseActionFields {
    const title = extractLabeledValue(userMessage, ['title', 'name', 'use case name']) || extractQuotedAfter(userMessage, ['create', 'register', 'add']);
    const priority = extractLabeledValue(userMessage, ['priority']) || userMessage.match(/\b(critical|high|medium|low)\s+priority\b/i)?.[1];
    return {
        title,
        description: extractLabeledValue(userMessage, ['description', 'overview', 'summary']),
        business_problem_statement: extractLabeledValue(userMessage, ['business_problem_statement', 'business problem statement', 'problem statement', 'problem']),
        expected_benefits: extractLabeledValue(userMessage, ['expected_benefits', 'expected benefits', 'benefits', 'value']),
        priority: priority ? priority[0].toUpperCase() + priority.slice(1).toLowerCase() : undefined,
        regulatory_impact: extractListValue(userMessage, ['regulatory_impact', 'regulatory impact', 'compliance']),
        solution_approach: extractLabeledValue(userMessage, ['solution_approach', 'solution approach', 'approach']),
        use_case_owner: extractLabeledValue(userMessage, ['use_case_owner', 'use case owner', 'owner']),
        impacted_business_applications: extractListValue(userMessage, ['impacted_business_applications', 'impacted applications', 'applications']),
        impacted_business_processes: extractListValue(userMessage, ['impacted_business_processes', 'impacted processes', 'business processes']),
    };
}

function missingUseCaseFields(fields: UseCaseActionFields): string[] {
    return ['title', 'description', 'business_problem_statement', 'expected_benefits', 'priority'].filter(key => !fields[key as keyof UseCaseActionFields]);
}

function formatToolResult(result: any): string {
    if (!result) return 'The MCP tool completed but returned no details.';
    if (typeof result === 'string') return result;
    const id = result.identifier || result.number || result.id || result.sys_id;
    const name = result.name || result.title || result.use_case_name;
    const status = result.status || result.state || result.workflow_state;
    return [
        'MCP tool completed successfully.',
        name ? `Name: ${name}` : '',
        id ? `Identifier: ${id}` : '',
        status ? `Status: ${status}` : '',
    ].filter(Boolean).join('\n');
}

class McpClientService {
    private initialized = false;
    private sessionId: string | null = null;
    private tenantId: string | null = null;
    private _agentCache: AgentData[] | null = null;
    private _useCaseCache: UseCaseSummary[] | null = null;
    private _agentDetailCache = new Map<string, AgentData>();
    private _riskSummaryCache = new Map<string, any>();
    private _useCaseDetailCache = new Map<string, UseCaseDetail>();
    private _pendingRequests = new Map<string, Promise<any>>();
    private _cachedDataStore: any = null;
    private _mcpTools: Array<{ name: string; description?: string; inputSchema?: any }> | null = null;

    private getMcpUrl(): string {
        const configured = localStorage.getItem('tavro_mcp_url')?.trim();
        return configured || 'http://localhost:9001/mcp';
    }

    private getToken(): string {
        // MCP OAuth token takes priority over Zitadel tokens
        return localStorage.getItem('tavro_mcp_access_token')
            || localStorage.getItem('tavro_access_token')
            || localStorage.getItem('tavro_id_token')
            || '';
    }

    private async ensureValidToken(): Promise<string> {
        // If a dedicated MCP OAuth token exists, use it directly —
        // its lifecycle is managed by the MCP OAuth flow, not Zitadel.
        const mcpToken = localStorage.getItem('tavro_mcp_access_token');
        if (mcpToken) return mcpToken;

        // Fall back to Zitadel token with silent refresh
        if (isAccessTokenExpired()) {
            const ok = await refreshAccessToken();
            if (!ok) {
                throw new Error('Token refresh failed. Please log in again.');
            }
        }
        const token = this.getToken();
        if (!token) throw new Error('No auth token. Please log in again.');
        return token;
    }

    private handleUnauthorized(bodyText?: string) {
        appLogger.warn('401 Unauthorized from MCP server', { body: bodyText });
        this.disconnect();
        throw new Error('MCP request unauthorized. Please check your credentials.');
    }

    /** Manual connect via fetch to capture mcp-session-id and tenant_id */
    async connect(): Promise<void> {
        if (this.initialized) return;

        const mcpUrl = this.getMcpUrl();
        const savedTenantId = localStorage.getItem('tavro_tenant_id');

        if (localStorage.getItem('tavro_cache_mode') === 'true') {
            this.initialized = true;
            return;
        }

        const token = await this.ensureValidToken();

        try {
            const initBody = {
                jsonrpc: '2.0',
                id: 'init',
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'tavro-app', version: '1.0.0' },
                    meta: savedTenantId ? { tenant_id: savedTenantId } : {}
                }
            };

            const initHeaders = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'ngrok-skip-browser-warning': 'true',
                ...(savedTenantId ? { 'tenant_id': savedTenantId } : {})
            };

            appLogger.info('MCP initialize → request', { headers: initHeaders, body: initBody });

            const res = await fetch(mcpUrl, {
                method: 'POST',
                headers: initHeaders,
                body: JSON.stringify(initBody)
            });

            if (!res.ok) {
                const body = await res.text();
                if (res.status === 401) this.handleUnauthorized(body);
                throw new Error(`MCP initialization failed: HTTP ${res.status}: ${body}`);
            }

            // Capture session and tenant metadata from headers
            this.sessionId = res.headers.get('mcp-session-id');
            const serverTenantId = res.headers.get('x-tenant-id') || res.headers.get('mcp-tenant-id') || res.headers.get('tenant_id');

            if (serverTenantId) {
                this.tenantId = serverTenantId;
                localStorage.setItem('tavro_tenant_id', serverTenantId);
            } else if (savedTenantId) {
                this.tenantId = savedTenantId;
            }

            this.initialized = true;
            appLogger.info('MCP Session established', { sessionId: this.sessionId, tenantId: this.tenantId });

        } catch (err: any) {
            appLogger.error('MCP Manual connection failed', { error: err.message });
            throw err;
        }
    }

    // Write tools always execute live — cache mode only applies to reads.
    private static readonly WRITE_TOOLS = new Set([
        'create_agent',
        'create_ai_use_case',
        'create_ai_use_case_agent_relationship',
        'remove_ai_use_case_agent_relationship',
        'create_risk_assessment',

    ]);

    private async callTool(name: string, args: any = {}): Promise<any> {
        const isCacheMode = localStorage.getItem('tavro_cache_mode') === 'true';
        if (isCacheMode && !McpClientService.WRITE_TOOLS.has(name)) {
            return await this._getCachedToolResult(name, args);
        }

        const token = await this.ensureValidToken();
        if (!this.sessionId) this.initialized = false;
        if (!this.initialized) await this.connect();

        const mcpUrl = this.getMcpUrl();
        const t0 = Date.now();
        // original_prompt must come AFTER the spread so it is never overwritten by an
        // empty/undefined value that the LLM might have placed in toolCall.arguments.
        const toolArgs = {
            ...args,
            original_prompt: (args.original_prompt && String(args.original_prompt).trim())
                ? args.original_prompt
                : `User requested ${name} via Dashboard UI`,
        };
        const requestBody = {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name, arguments: toolArgs }
        };
        const requestHeaders = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'mcp-session-id': this.sessionId || '',
            'Accept': 'application/json, text/event-stream',
            'ngrok-skip-browser-warning': 'true',
            ...(this.tenantId ? { 'tenant_id': this.tenantId } : {})
        };

        appLogger.tool(`${name} -> request`, { headers: requestHeaders, body: requestBody });

        const executeToolCall = async (): Promise<any> => {
            const res = await fetch(mcpUrl, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(requestBody)
            });
            const rawText = await res.text();

            if (!res.ok) {
                if (res.status === 401) this.handleUnauthorized(rawText);
                const isSessionError = (res.status === 404 || res.status === 400)
                    && rawText.toLowerCase().includes('session not found');
                if (isSessionError) {
                    const e: any = new Error(`Tool call failed: HTTP ${res.status}: ${rawText}`);
                    e.code = 'MCP_SESSION_NOT_FOUND';
                    throw e;
                }
                throw new Error(`Tool call failed: HTTP ${res.status}: ${rawText}`);
            }

            let json: any;
            if (res.headers.get('content-type')?.includes('text/event-stream')) {
                const lines = rawText.split('\n');
                for (const line of lines) {
                    if (line.trim().startsWith('data:')) {
                        const data = line.trim().slice(5).trim();
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.result || parsed.error || parsed.method) {
                                json = parsed;
                                break;
                            }
                        } catch { }
                    }
                }
            } else {
                try { json = JSON.parse(rawText); } catch { throw new Error(`Failed to parse JSON response: ${rawText.substring(0, 100)}`); }
            }

            if (!json) throw new Error(`No valid MCP response found in: ${rawText.substring(0, 100)}`);
            if (json.error) {
                if (String(json.error.message || '').toLowerCase().includes('session not found')) {
                    const e: any = new Error(`MCP Error ${json.error.code}: ${json.error.message}`);
                    e.code = 'MCP_SESSION_NOT_FOUND';
                    throw e;
                }
                throw new Error(`MCP Error ${json.error.code}: ${json.error.message}`);
            }

            const content = json.result?.content as any[];
            if (!content || !content.length) return null;
            const text = content[0].text;
            try { return JSON.parse(text); } catch { return text; }
        };

        try {
            let result: any;
            try {
                result = await executeToolCall();
            } catch (err: any) {
                if (err?.code === 'MCP_SESSION_NOT_FOUND') {
                    appLogger.warn(`Stale MCP session for ${name}; reconnecting and retrying once.`);
                    this.sessionId = null;
                    this.initialized = false;
                    await this.connect();
                    result = await executeToolCall();
                } else {
                    throw err;
                }
            }
            appLogger.tool(`${name} <- result`, { response: result, durationMs: Date.now() - t0 });
            return result;
        } catch (err: any) {
            appLogger.error(`callTool failed - ${name}`, { error: err.message });
            throw err;
        }
    }

    async listTools(): Promise<{ name: string; description?: string; inputSchema?: any }[]> {
        if (localStorage.getItem('tavro_cache_mode') === 'true') {
            return [
                { name: 'get_agent_catalog', description: 'Get agent catalog' },
                { name: 'get_agent_card', description: 'Get agent details' },
                { name: 'get_ai_use_case', description: 'Get AI use cases or details' }
            ];
        }
        await this.connect();
        const mcpUrl = this.getMcpUrl();
        const res = await fetch(mcpUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.getToken()}`,
                'Content-Type': 'application/json',
                'mcp-session-id': this.sessionId || '',
                'Accept': 'application/json, text/event-stream',
                'ngrok-skip-browser-warning': 'true',
                ...(this.tenantId ? { 'tenant_id': this.tenantId } : {})
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'list_tools',
                method: 'tools/list',
                params: {}
            })
        });

        const rawText = await res.text();
        let json: any;

        if (res.headers.get('content-type')?.includes('text/event-stream')) {
            const lines = rawText.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('data:')) {
                    const data = line.trim().slice(5).trim();
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.result) { json = parsed; break; }
                    } catch { /* skip */ }
                }
            }
        } else {
            try { json = JSON.parse(rawText); } catch { json = {}; }
        }

        return (json?.result?.tools || []) as { name: string; description?: string; inputSchema?: any }[];
    }

    /** Fetch MCP tool definitions (with schema) and cache them for the session. */
    async fetchMcpTools(): Promise<{ name: string; description?: string; inputSchema?: any }[]> {
        if (this._mcpTools !== null) return this._mcpTools;
        if (localStorage.getItem('tavro_cache_mode') === 'true') {
            this._mcpTools = [];
            return this._mcpTools;
        }
        try {
            this._mcpTools = await this.listTools();
            appLogger.info('MCP tools loaded', { count: this._mcpTools.length, names: this._mcpTools.map(t => t.name) });
        } catch (err: any) {
            appLogger.error('Failed to fetch MCP tools', { error: err.message });
            this._mcpTools = [];
        }
        return this._mcpTools;
    }

    /** Convert MCP tool definitions to the canonical ToolDefinition format for AgentRuntime. */
    private _buildToolDefs(tools: { name: string; description?: string; inputSchema?: any }[]): ToolDefinition[] {
        return tools.map(t => ({
            name: t.name,
            description: t.description || t.name,
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
        }));
    }

    async *chat(userMessage: string, history: ChatMessage[] = [], context: ChatViewContext = {}): AsyncGenerator<string> {
        const llmCfg = getLLMConfig();

        if (llmCfg) {
            yield* this._llmChatWithTools(userMessage, history, context, llmCfg);
            return;
        }

        // No LLM configured — fall back to hardcoded action handling and intent chat
        const actionHandled = await this._handleAssistantAction(userMessage, context);
        if (actionHandled) {
            yield actionHandled;
            return;
        }
        yield* this._intentChat(userMessage, context);
    }

    private async *_llmChatWithTools(
        userMessage: string,
        history: ChatMessage[],
        context: ChatViewContext,
        llmCfg: LLMConfig,
    ): AsyncGenerator<string> {
        try {
            const mcpTools = await this.fetchMcpTools();
            const toolDefs = this._buildToolDefs(mcpTools);

            // Build tool guidance — injected into the system prompt so the LLM knows
            // which tools are available and how to call them without asking for confirmation.
            const toolGuidance = mcpTools.length > 0 ? (() => {
                const toolSummary = mcpTools.map(t => {
                    const props = t.inputSchema?.properties || {};
                    const required = (t.inputSchema?.required || [] as string[]).filter((f: string) => f !== 'original_prompt');
                    const optional = Object.keys(props).filter((f: string) => f !== 'original_prompt' && !required.includes(f));
                    const parts: string[] = [];
                    if (required.length) parts.push(`required: ${required.join(', ')}`);
                    if (optional.length) parts.push(`optional: ${optional.join(', ')}`);
                    return `  - ${t.name}${parts.length ? ` (${parts.join(' | ')})` : ''}`;
                }).join('\n');

                return `

## MCP Tool Usage — STRICT RULES
You are an action-first assistant. Each tool below has a description — match the user's intent to the best-fitting tool and call it immediately. Do not ask for confirmation. Do not say "I will now…". Just call the tool.

### Decision rule
Read the user's message. If it maps to any tool's purpose (based on the tool description below), call that tool right away with all parameters filled in. If the user is confirming or agreeing to something you previously described, call the corresponding tool immediately using the values you already have.

### How to fill parameters
- \`original_prompt\`: ALWAYS set to the user's EXACT verbatim message, word-for-word.
- Required parameters: derive from the user's message or generate professional, domain-appropriate values if not explicitly stated.
- Optional parameters: NEVER pass null. Always provide a realistic value:
  - List fields: supply 2–3 meaningful objects, each with "name" and "description".
  - String fields: write a concise, relevant sentence based on the domain or topic.

### When NOT to call a tool
Only ask the user for clarification if they have given you no context at all (no domain, no topic, no resource name) and have not asked you to generate or assume values.

### Available tools
${toolSummary}`;
            })() : '';

            const baseSystemPrompt =
                (context.systemPrompt ||
                    `You are Tavro AI assistant. Use the available MCP tools to answer questions about AI agents, use cases, and risk assessments. Call tools whenever you need live data.`) +
                toolGuidance;

            if (toolDefs.length === 0) {
                // No MCP tools — enrich context with catalog snapshot and stream directly.
                const [agents, useCases] = await Promise.all([this.getAllAgents(), this.getAllUseCases()]);
                const agentRows = agents.map(a => `- [AGENT:${a.identification?.agent_id || 'N/A'}] ${a.name} | risk:${getRiskLevel(a)}`).join('\n');
                const useCaseRows = useCases.map(u => `- [USECASE:${u.identifier || 'N/A'}] ${u.name} | status:${u.status}`).join('\n');
                const catalogBlock = `\n\n## Live Catalog Data\nAGENTS:\n${agentRows}\n\nUSE CASES:\n${useCaseRows}`;
                yield* copilotOrchestrator.run(
                    baseSystemPrompt + catalogBlock,
                    history.slice(-10),
                    userMessage,
                    [],
                    llmCfg,
                    async () => null,
                );
                return;
            }

            yield* copilotOrchestrator.run(
                baseSystemPrompt,
                history.slice(-10),
                userMessage,
                toolDefs,
                llmCfg,
                (name, args, originalPrompt) => this._executeToolForRuntime(name, args, originalPrompt),
            );

        } catch (err: any) {
            appLogger.error('LLM chat failed', { error: err?.message ?? String(err) });
            yield `I could not reach the configured LLM (${llmCfg.provider} · ${llmCfg.model}): ${err?.message ?? 'unknown error'}\n\n${this._buildContextFallbackResponse(userMessage, context)}`;
        }
    }

    /**
     * Tool executor passed to AgentRuntime.
     *
     * Ensures original_prompt is always present (required by the MCP server), then
     * delegates to callTool() which owns the MCP session reconnect/retry logic.
     * Errors are returned as { error, details } objects rather than thrown so that
     * AgentRuntime injects them into context and the LLM can observe and adapt.
     */
    private async _executeToolForRuntime(
        name: string,
        args: Record<string, any>,
        originalPrompt: string,
    ): Promise<any> {
        const toolArgs = {
            ...args,
            original_prompt: (args.original_prompt && String(args.original_prompt).trim())
                ? args.original_prompt
                : originalPrompt || `User requested ${name} via Dashboard UI`,
        };
        try {
            return await this.callTool(name, toolArgs);
        } catch (err: any) {
            appLogger.error(`Tool execution failed: ${name}`, { error: err.message });
            return { error: err.message, details: 'Tool execution failed. The agent may retry with corrected arguments.' };
        }
    }

    private _formatToolResultForDisplay(toolName: string, result: any): string {
        if (!result) return `**${toolName}** completed with no data returned.`;

        if (typeof result === 'object' && result.error) {
            const detail = result.details || result.message || '';
            return `**${toolName}** returned an error:\n\n${result.error}${detail ? `\n\n${detail}` : ''}`;
        }

        if (typeof result === 'string') return result;

        // Flatten a single-key wrapper (e.g. { agent_card: {...} } → the inner object)
        const keys = Object.keys(result);
        const unwrapped = keys.length === 1 && typeof result[keys[0]] === 'object' ? result[keys[0]] : result;
        const target = Array.isArray(unwrapped) ? unwrapped : [unwrapped];

        const lines: string[] = [];
        for (const item of target) {
            if (!item || typeof item !== 'object') { lines.push(String(item)); continue; }
            const fields = Object.entries(item)
                .filter(([, v]) => v !== null && v !== undefined && v !== '')
                .map(([k, v]) => {
                    const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
                    return `**${label}:** ${value}`;
                });
            lines.push(fields.join('\n'));
        }

        return lines.join('\n\n---\n\n');
    }

    private async _handleAssistantAction(userMessage: string, context: ChatViewContext): Promise<string | null> {
        const msg = userMessage.toLowerCase();
        if ((msg.includes('create') || msg.includes('register') || msg.includes('add')) && msg.includes('use case')) {
            const fields = parseUseCaseActionFields(userMessage);
            const missing = missingUseCaseFields(fields);
            if (missing.length) {
                return `I can create the AI use case through the MCP tool, but I need these required fields first:\n${missing.map(field => `• ${field}`).join('\n')}\n\nYou can provide them as labels, for example: title: ..., description: ..., problem statement: ..., expected benefits: ..., priority: High.`;
            }
            try {
                const result = await this.createAiUseCase({ ...fields, original_prompt: userMessage });
                return `Created the AI use case using MCP tool \`create_ai_use_case\`.\n\n${formatToolResult(result)}`;
            } catch (err: any) {
                return `I tried to create the AI use case using MCP tool \`create_ai_use_case\`, but the tool call failed: ${err.message}`;
            }
        }
        if ((msg.includes('risk assessment') || msg.includes('assess risk')) && (msg.includes('create') || msg.includes('request') || msg.includes('run'))) {
            const agentId = extractLabeledValue(userMessage, ['agent_id', 'agent id', 'agent']) || context.viewData?.identification?.agent_id || context.viewData?.agent_id || context.viewData?.id;
            if (!agentId) return 'I can request a risk assessment through MCP, but I need an agent ID. Provide it as `agent_id: ...` or open an agent detail page and ask again.';
            try {
                const result = await this.createRiskAssessment(agentId);
                return `Requested a risk assessment using MCP tool \`create_risk_assessment\` for agent \`${agentId}\`.\n\n${formatToolResult(result)}`;
            } catch (err: any) {
                return `I tried to request the risk assessment using MCP tool \`create_risk_assessment\`, but the tool call failed: ${err.message}`;
            }
        }
        if ((msg.includes('link') || msg.includes('associate')) && msg.includes('agent') && msg.includes('use case')) {
            const useCaseId = extractLabeledValue(userMessage, ['use_case_id', 'use case id', 'ai_use_case_id']) || context.viewData?.identifier || context.viewData?.id;
            const agentId = extractLabeledValue(userMessage, ['agent_id', 'agent id', 'agent_catalog_id']);
            if (!useCaseId || !agentId) return 'I can link an agent to a use case through MCP, but I need both `use_case_id: ...` and `agent_id: ...`.';
            try {
                const result = await this.createAiUseCaseAgentRelationship(useCaseId, agentId);
                return `Linked agent \`${agentId}\` to use case \`${useCaseId}\` using MCP tool \`create_ai_use_case_agent_relationship\`.\n\n${formatToolResult(result)}`;
            } catch (err: any) {
                return `I tried to link the agent and use case using MCP tool \`create_ai_use_case_agent_relationship\`, but the tool call failed: ${err.message}`;
            }
        }
        return null;
    }

    private _buildContextFallbackResponse(userMessage: string, context: ChatViewContext): string {
        const msg = userMessage.toLowerCase();
        const data = context.viewData;
        if (context.viewType === 'use_case_detail' && data) {
            if (msg.includes('business impact') || msg.includes('impact')) {
                return [
                    `Based on the current use case, the business impact is tied to: ${data.name || data.title || 'this use case'}.`,
                    data.problem_statement ? `Problem: ${data.problem_statement}` : '',
                    data.expected_benefits ? `Expected benefits: ${data.expected_benefits}` : '',
                    data.priority ? `Priority: ${data.priority}` : '',
                ].filter(Boolean).join('\n\n');
            }
            return [
                `Current use case: ${data.name || data.title || data.identifier || 'Untitled use case'}`,
                data.description ? `Description: ${data.description}` : '',
                data.status ? `Status: ${data.status}` : '',
                data.owner ? `Owner: ${data.owner}` : '',
                data.expected_benefits ? `Expected benefits: ${data.expected_benefits}` : '',
            ].filter(Boolean).join('\n\n');
        }
        if (context.viewType === 'agent_detail' && data) {
            if (msg.includes('risk')) {
                const risk = data.risk_assessment?.blended_risk_classification || data.latest_risk_class || getRiskLevel(data);
                return `Based on the current agent, the risk level is ${risk}.`;
            }
            return [
                `Current agent: ${data.name || data.agent_name || 'Unnamed agent'}`,
                data.description ? `Description: ${data.description}` : '',
                data.identification?.agent_id ? `Agent ID: ${data.identification.agent_id}` : '',
            ].filter(Boolean).join('\n\n');
        }
        return '';
    }

    private async *_intentChat(userMessage: string, context: ChatViewContext = {}): AsyncGenerator<string> {
        const msg = userMessage.toLowerCase();
        const fallback = this._buildContextFallbackResponse(userMessage, context);
        if (fallback) {
            yield fallback;
            return;
        }
        try {
            if (msg.includes('high risk')) {
                const agents = await this.getAllAgents();
                const hr = agents.filter(a => getRiskLevel(a) === 'high');
                yield hr.length ? `High-risk agents:\n${hr.map(a => `• ${a.name}`).join('\n')}` : 'No high-risk agents.';
                return;
            }
            const agents = await this.getAllAgents();
            yield `Connected to Tavro MCP. Agents: ${agents.length}.`;
        } catch { yield 'Error reaching MCP server.'; }
    }

    async disconnect(): Promise<void> {
        this.sessionId = null;
        this.initialized = false;
    }

    private static readonly MAX_RECORDS_PER_PAGE = 10;

    async getCatalogPage(startRecord = 1): Promise<{ agents: AgentData[]; totalRecords: number }> {
        if (this._agentCache) {
            const sliced = this._agentCache.slice(startRecord - 1, startRecord - 1 + McpClientService.MAX_RECORDS_PER_PAGE);
            return { agents: sliced, totalRecords: this._agentCache.length };
        }
        try {
            const data = await this.callTool('get_agent_catalog', { start_record: startRecord, record_range: `${startRecord}-${startRecord + 9}` });
            let rawList: any[] = [];
            if (Array.isArray(data)) rawList = data;
            else if (data) {
                const candidates = [data.agent_card, data.agent_cards, data.agents, data.catalog, data.items, data.records, data.data, data.results];
                for (const c of candidates) { if (Array.isArray(c)) { rawList = c; break; } }
            }
            const agents = rawList.map(item => ({
                ...item,
                name: item.name || item.agent_name || 'Unnamed Agent',
                identification: { ...item.identification, agent_id: item.identification?.agent_id || item.agent_id || 'Unknown' },
                risk_assessment: normalizeRiskAssessment(item),
                risk_summary:
                    item.risk_summary ??
                    item.summary ??
                    item.risk_assessment?.summary ??
                    item.risk_assessment_summary ??
                    item.ai_risk_summary ??
                    '',
            }));
            return { agents, totalRecords: data?.total_records ?? agents.length };
        } catch (err) { throw err; }
    }

    async getCatalog(page = 1, pageSize = 10): Promise<AgentData[]> {
        const { agents } = await this.getCatalogPage((page - 1) * pageSize + 1);
        return agents;
    }

    async getAgentDetails(id: string): Promise<AgentData | undefined> {
        if (this._agentDetailCache.has(id)) return this._agentDetailCache.get(id);
        try {
            const isId = /^[0-9a-f]{32}|[0-9a-f-]{36}|TAV/i.test(id);
            const data = await this.callTool('get_agent_card', isId ? { agent_id: id } : { agent_name: id });
            if (data?.error) return undefined;
            const agent = unwrapToolResponse(data, ['agent_card', 'agent', 'data', 'details']);
            if (!agent || agent?.error) return undefined;
            if (agent) this._agentDetailCache.set(id, agent);
            return agent;
        } catch { return undefined; }
    }

    async getAgentRiskSummary(agentId: string): Promise<any> {
        if (this._riskSummaryCache.has(agentId)) return this._riskSummaryCache.get(agentId);
        try {
            const details = await this.getAgentDetails(agentId);
            const summary =
                (details as any)?.risk_summary ??
                (details as any)?.summary ??
                (details as any)?.risk_assessment?.summary ??
                '';
            if (!summary) return undefined;

            const payload = {
                agent_id: details?.identification?.agent_id || agentId,
                agent_name: details?.name || agentId,
                risk_summary: String(summary),
            };
            this._riskSummaryCache.set(agentId, payload);
            return payload;
        } catch {
            return undefined;
        }
    }

    async getAllAgents(): Promise<AgentData[]> {
        if (this._agentCache) return this._agentCache;
        const first = await this.getCatalogPage(1);
        const all = [...first.agents];
        const total = first.totalRecords;
        let start = 11;
        while (start <= total) {
            const { agents } = await this.getCatalogPage(start);
            all.push(...agents);
            start += 10;
        }
        this._agentCache = all;
        return all;
    }

    invalidateCache(): void {
        this._agentCache = null;
        this._useCaseCache = null;
        this._agentDetailCache.clear();
        this._riskSummaryCache.clear();
        this._useCaseDetailCache.clear();
        this._pendingRequests.clear();
        this._cachedDataStore = null;
        this._mcpTools = null;
    }

    private async _loadCachedData(): Promise<void> {
        const remoteUrl = localStorage.getItem('tavro_cached_data_url');
        const localPath = localStorage.getItem('tavro_cached_data_local_path');
        if (remoteUrl) {
            try {
                const res = await fetch(remoteUrl);
                if (res.ok) { this._cachedDataStore = await res.json(); return; }
            } catch { }
        }
        if (localPath) {
            try {
                const res = await fetch(new URL(localPath, window.location.origin).toString());
                if (res.ok) { this._cachedDataStore = await res.json(); return; }
            } catch { }
        }
        try {
            const localData = await import('../data/mcpCachedData.json');
            this._cachedDataStore = (localData as any).default ?? localData;
        } catch { this._cachedDataStore = { tools: {} }; }
    }

    private async _getCachedToolResult(name: string, args: any): Promise<any> {
        if (!this._cachedDataStore) await this._loadCachedData();
        const tools = (this._cachedDataStore?.tools as Record<string, any>) ?? {};
        const exact = tools[`${name}:${JSON.stringify(args)}`];
        if (exact) return exact;
        if (name === 'get_agent_card') return this._getCachedAgentDetail(args);
        if (name === 'get_ai_use_case') return this._getCachedUseCaseDetail(args);
        return null;
    }

    private _getCachedToolPages(prefix: string): any[] {
        const tools = (this._cachedDataStore?.tools as Record<string, any>) ?? {};
        return Object.entries(tools)
            .filter(([key]) => key.startsWith(prefix))
            .flatMap(([, value]) => {
                if (Array.isArray(value)) return value;
                if (Array.isArray(value?.data)) return value.data;
                if (Array.isArray(value?.results)) return value.results;
                if (Array.isArray(value?.items)) return value.items;
                if (Array.isArray(value?.agent_card)) return value.agent_card;
                if (Array.isArray(value?.ai_use_case_agent_card)) return value.ai_use_case_agent_card;
                return [];
            });
    }

    private _normaliseCachedAgent(raw: any): AgentData {
        return {
            ...raw,
            name: raw.name || raw.agent_name || 'Unnamed Agent',
            description: raw.description || raw.agent_description || raw.summary || '',
            version: raw.version || '1.0',
            identification: {
                ...(raw.identification ?? {}),
                agent_id: raw.identification?.agent_id || raw.agent_id || raw.agent_internal_id || raw.id || raw.name || raw.agent_name || 'Unknown',
                owner: raw.identification?.owner || raw.owner || raw.agent_owner || raw.agent_owner_name,
                instruction: raw.identification?.instruction || raw.instruction || raw.agent_description || raw.summary,
                environment: raw.identification?.environment || raw.environment,
            },
            capabilities: raw.capabilities ?? {},
            application: raw.application ?? [],
            risk_assessment: normalizeRiskAssessment(raw),
            risk_summary:
                raw.risk_summary ??
                raw.summary ??
                raw.risk_assessment?.summary ??
                raw.risk_assessment_summary ??
                raw.ai_risk_summary ??
                '',
        } as AgentData;
    }

    private _getCachedAgentDetail(args: any): any {
        const target = String(args.agent_id || args.agent_name || '').toLowerCase();
        if (!target) return null;
        const found = this._getCachedToolPages('get_agent_catalog:').find(raw => {
            const values = [
                raw.agent_id,
                raw.agent_internal_id,
                raw.id,
                raw.name,
                raw.agent_name,
                raw.identification?.agent_id,
            ];
            return values.some(value => String(value || '').toLowerCase() === target);
        });
        return found ? { agent_card: this._normaliseCachedAgent(found) } : null;
    }

    private _getCachedUseCaseDetail(args: any): any {
        const target = String(args.use_case_id || args.title || '').toLowerCase();
        if (!target) return null;
        const found = this._getCachedToolPages('get_ai_use_case:').find(raw => {
            const values = [
                raw.use_case_id,
                raw.identifier,
                raw.number,
                raw.id,
                raw.title,
                raw.name,
                raw.use_case_name,
            ];
            return values.some(value => String(value || '').toLowerCase().trim() === target.trim());
        });
        return found ? { ai_use_case_agent_card: found } : null;
    }

    async generateCachedData(): Promise<string> {
        localStorage.setItem('tavro_cache_mode', 'false');
        try {
            const tools: Record<string, any> = {};
            const res = await this.callTool('get_agent_catalog', { start_record: 1, record_range: '1-10' });
            tools[`get_agent_catalog:{"start_record":1,"record_range":"1-10"}`] = res;
            return JSON.stringify({ tools }, null, 2);
        } finally {
            localStorage.setItem('tavro_cache_mode', 'true');
        }
    }

    async getUseCaseCatalogPage(startRecord = 1): Promise<{ useCases: UseCaseSummary[]; totalRecords: number }> {
        if (this._useCaseCache) {
            const sliced = this._useCaseCache.slice(startRecord - 1, startRecord + 9);
            return { useCases: sliced, totalRecords: this._useCaseCache.length };
        }
        try {
            const data = await this.callTool('get_ai_use_case', { start_record: startRecord, record_range: `${startRecord}-${startRecord + 9}` });
            let rawList: any[] = [];
            if (Array.isArray(data)) rawList = data;
            else if (data) {
                const candidates = [data.ai_use_case_agent_card, data.use_cases, data.ai_use_cases, data.useCases, data.items, data.results, data.data];
                for (const c of candidates) { if (Array.isArray(c)) { rawList = c; break; } }
            }
            const useCases = rawList.map(normaliseUseCase);
            return { useCases, totalRecords: data?.total_records ?? useCases.length };
        } catch (err) { throw err; }
    }

    async getAllUseCases(): Promise<UseCaseSummary[]> {
        if (this._useCaseCache) return this._useCaseCache;
        const first = await this.getUseCaseCatalogPage(1);
        const all = [...first.useCases];
        const total = first.totalRecords;
        let start = 11;
        while (start <= total) {
            const { useCases } = await this.getUseCaseCatalogPage(start);
            all.push(...useCases);
            start += 10;
        }
        // Deduplicate by identifier in case the server returns the same item on multiple pages
        const seen = new Set<string>();
        const deduped = all.filter(uc => {
            const id = uc.identifier || (uc as any).id;
            if (!id) return true;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
        this._useCaseCache = deduped;
        return deduped;
    }

    async getUseCaseDetails(id: string, opts?: { forceRefresh?: boolean }): Promise<UseCaseDetail | undefined> {
        const forceRefresh = opts?.forceRefresh === true;
        if (!forceRefresh && this._useCaseDetailCache.has(id)) return this._useCaseDetailCache.get(id);
        if (forceRefresh) this._useCaseDetailCache.delete(id);
        try {
            const isId = /^[0-9a-f]{32}|[0-9a-f-]{36}|TAV/i.test(id);
            const data = await this.callTool('get_ai_use_case', isId ? { use_case_id: id } : { title: id });
            const unwrapped = unwrapToolResponse(data, ['ai_use_case_agent_card', 'use_case_card', 'ai_use_case', 'data']);
            if (unwrapped) {
                const detail = normaliseUseCase(unwrapped);
                this._useCaseDetailCache.set(id, detail);
                return detail;
            }
            return undefined;
        } catch { return undefined; }
    }

    async createAiUseCase(fields: any): Promise<any> {
        // Server-side create_ai_use_case is strict; pass only supported args.
        const title = (fields?.title ?? '').trim();
        const description = (fields?.description ?? '').trim() || title;
        const businessProblemStatement = (fields?.business_problem_statement ?? '').trim() || description;
        const expectedBenefits = (fields?.expected_benefits ?? '').trim() || description;
        const rawPriority = String(fields?.priority ?? '').trim();
        const priorityMap: Record<string, string> = {
            'critical': '1 - Critical',
            'high': '2 - High',
            'medium': '3 - Moderate',
            'moderate': '3 - Moderate',
            'low': '4 - Low',
            'planning': '5 - Planning',
            '1': '1 - Critical',
            '2': '2 - High',
            '3': '3 - Moderate',
            '4': '4 - Low',
            '5': '5 - Planning',
            '1 - critical': '1 - Critical',
            '2 - high': '2 - High',
            '3 - moderate': '3 - Moderate',
            '4 - low': '4 - Low',
            '5 - planning': '5 - Planning',
        };
        const priority = priorityMap[rawPriority.toLowerCase()] || '3 - Moderate';
        const payload = {
            title,
            description,
            business_problem_statement: businessProblemStatement,
            expected_benefits: expectedBenefits,
            priority,
            ...(fields?.regulatory_impact ? { regulatory_impact: fields.regulatory_impact } : {}),
            ...(fields?.solution_approach ? { solution_approach: fields.solution_approach } : {}),
            ...(fields?.use_case_owner ? { use_case_owner: fields.use_case_owner } : {}),
            ...(fields?.impacted_business_applications ? { impacted_business_applications: fields.impacted_business_applications } : {}),
            ...(fields?.impacted_business_processes ? { impacted_business_processes: fields.impacted_business_processes } : {}),
            ...(fields?.original_prompt ? { original_prompt: fields.original_prompt } : {}),
        };
        const data = await this.callTool('create_ai_use_case', payload);
        this.invalidateCache();
        return data;
    }

    async createAiUseCaseAgentRelationship(use_case_id: string, agent_id: string): Promise<any> {
        const data = await this.callTool('create_ai_use_case_agent_relationship', { ai_use_case_id: use_case_id, agent_catalog_id: agent_id });
        if (data && typeof data === 'object' && data.error) {
            throw new Error(data.details || data.error);
        }
        this.invalidateCache();
        return data;
    }

    async removeAiUseCaseAgentRelationship(use_case_id: string, agent_id: string): Promise<any> {
        const data = await this.callTool('remove_ai_use_case_agent_relationship', { ai_use_case_id: use_case_id, agent_catalog_id: agent_id });
        if (data && typeof data === 'object' && data.error) {
            throw new Error(data.details || data.error);
        }
        this.invalidateCache();
        return data;
    }

    async createAgent(args: any): Promise<any> {
        // Server-side create_agent has a strict signature; drop unsupported
        // UI-only fields (owner/role/environment) to avoid tool validation errors.
        const agentName = (args?.agent_name ?? '').trim();
        const description = (args?.description ?? '').trim() || agentName;
        const instruction = (args?.instruction ?? '').trim() || description;
        const payload = {
            agent_name: agentName,
            description,
            instruction,
            ...(args?.tools ? { tools: args.tools } : {}),
            ...(args?.knowledge_source ? { knowledge_source: args.knowledge_source } : {}),
            ...(args?.original_prompt ? { original_prompt: args.original_prompt } : {}),
        };
        const data = await this.callTool('create_agent', payload);
        this.invalidateCache();
        return data;
    }

    async createRiskAssessment(agent_id: string): Promise<any> {
        return await this.callTool('create_risk_assessment', { agent_id });
    }

    async getExecutiveRiskSummary(): Promise<any[]> {
        const allAgents = await this.getAllAgents();
        const envMap = new Map<string, AgentData[]>();
        for (const agent of allAgents) {
            const env = agent.identification?.environment || 'Unknown';
            if (!envMap.has(env)) envMap.set(env, []);
            envMap.get(env)!.push(agent);
        }
        return Array.from(envMap.entries()).map(([env, agents]) => buildEnvSummary(env, agents));
    }
}

export const mcpClient = new McpClientService();
