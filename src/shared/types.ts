export interface AgentLimitsInfo {
  cursor?: {
    loggedIn: boolean;
    tier?: string;
    email?: string;
    defaultModel?: string;
    version?: string;
    quotaDetails?: string;
  };
  antigravity?: {
    available: boolean;
    tier?: string;
    fiveHourLimit?: {
      total: number;
      used: number;
      remaining: number;
      percentRemaining: number;
      resetsIn: string;
    };
    weeklyLimit?: {
      total: number;
      used: number;
      remaining: number;
      percentRemaining: number;
      resetsIn: string;
    };
    brainConversationsCount: number;
    brainStorageSizeMb: number;
    models: string[];
  };
}

export interface DeviceInfo {
  id: string;
  name: string;
  token: string;
  status: 'online' | 'offline';
  os: string;
  hostname: string;
  platform: string;
  arch: string;
  defaultWorkspace: string;
  cursorCliPath?: string;
  cursorAuthStatus?: {
    loggedIn: boolean;
    email?: string;
  };
  limitsInfo?: AgentLimitsInfo;
  antigravityAvailable?: boolean;
  lastSeen: number;
  cpuUsage?: number;
  memoryUsage?: {
    total: number;
    free: number;
    used: number;
  };
}

export interface ChatSession {
  id: string;
  deviceId: string;
  title: string;
  description?: string;
  engine?: 'cursor' | 'antigravity';
  createdAt: number;
  updatedAt: number;
  cursorChatId?: string; // Cursor CLI native chat ID if linked
  sourceSessionId?: string; // Source conversation ID from Antigravity / Cursor
  sourceFilePath?: string; // Local transcript file path on worker
  workspacePath: string;
  model: string;
  mode: 'agent' | 'plan' | 'ask' | 'yolo' | 'auto' | 'auto-review';
  messages: ChatMessage[];
  isStreaming?: boolean;
  status?: 'idle' | 'running' | 'completed' | 'error';
  thinkingEffort?: 'low' | 'medium' | 'high' | 'off';
  promptQueue?: string[];
}

export interface ToolCallItem {
  id: string;
  type: string;
  name: string;
  summary?: string;
  action?: string;
  input?: any;
  output?: string;
  status: 'running' | 'completed' | 'failed';
  startTime?: number;
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinkingContent?: string;
  timestamp: number;
  model?: string;
  toolCalls?: ToolCallItem[];
  isStreaming?: boolean;
}

export interface AgentRunOptions {
  sessionId: string;
  deviceId: string;
  prompt: string;
  model?: string;
  mode?: 'agent' | 'plan' | 'ask' | 'yolo' | 'auto' | 'auto-review';
  workspacePath?: string;
  cursorChatId?: string;
  sourceSessionId?: string;
  continueLastSession?: boolean;
  thinkingEffort?: 'low' | 'medium' | 'high' | 'off';
}

// WebSocket message types between Worker and Cloud Hub
export type WorkerToHubMessage =
  | { type: 'worker:register'; payload: DeviceInfo }
  | { type: 'worker:heartbeat'; payload: { deviceId: string; memoryUsage?: any; cpuUsage?: number } }
  | { type: 'agent:auth_url'; payload: { deviceId: string; url: string } }
  | { type: 'agent:auth_success'; payload: { deviceId: string } }
  | { type: 'agent:chunk'; payload: { sessionId: string; chunk: string; delta?: string } }
  | { type: 'agent:tool_call'; payload: { sessionId: string; toolCall: ToolCallItem } }
  | { type: 'agent:tool_result'; payload: { sessionId: string; toolCallId: string; result: string; status: 'completed' | 'failed' } }
  | { type: 'agent:complete'; payload: { sessionId: string; fullContent: string; cursorChatId?: string; success: boolean; error?: string } }
  | { type: 'agent:error'; payload: { sessionId: string; error: string } }
  | { type: 'terminal:output'; payload: { commandId: string; data: string; isError?: boolean } }
  | { type: 'terminal:exit'; payload: { commandId: string; code: number } }
  | { type: 'fs:tree_result'; payload: { reqId: string; tree: FileEntry[]; rootPath: string } }
  | { type: 'fs:file_result'; payload: { reqId: string; path?: string; content: string; error?: string } }
  | { type: 'fs:write_result'; payload: { reqId: string; success: boolean; error?: string } }
  | { type: 'transcripts:list_result'; payload: { reqId: string; transcripts: any[] } }
  | { type: 'transcripts:read_result'; payload: { reqId: string; result: any } }
  | { type: 'sessions:discovered'; payload: { deviceId: string; sessions: DiscoveredSession[] } }
  | { type: 'sessions:sync_update'; payload: { sessionId?: string; sourceSessionId?: string; sourceFilePath?: string; messages: ChatMessage[]; title?: string } };

export interface DiscoveredSession {
  id: string;
  title: string;
  updatedAt: number;
  workspacePath?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: FileEntry[];
}

// WebSocket message types between Cloud Hub and Worker
export type HubToWorkerMessage =
  | { type: 'agent:start'; payload: AgentRunOptions }
  | { type: 'agent:abort'; payload: { sessionId: string } }
  | { type: 'agent:trigger_auth'; payload: { deviceId: string } }
  | { type: 'terminal:run'; payload: { commandId: string; command: string; cwd?: string } }
  | { type: 'terminal:kill'; payload: { commandId: string } }
  | { type: 'fs:get_tree'; payload: { reqId: string; path?: string; maxDepth?: number } }
  | { type: 'fs:read_file'; payload: { reqId: string; path: string } }
  | { type: 'fs:write_file'; payload: { reqId: string; path: string; content: string } }
  | { type: 'transcripts:list_local'; payload: { reqId: string } }
  | { type: 'transcripts:read_local'; payload: { reqId: string; filePath: string } }
  | { type: 'sessions:scan'; payload: { deviceId: string } }
  | { type: 'sessions:watch'; payload: { sessions: { id: string; engine?: string; sourceSessionId?: string; sourceFilePath?: string; workspacePath?: string; cursorChatId?: string }[] } }
  | { type: 'sessions:force_sync'; payload: { reqId: string; sessionId: string; sourceSessionId?: string; sourceFilePath?: string; engine?: string } };

// WebSocket message types between Client (Web IDE) and Cloud Hub
export type ClientToHubMessage =
  | { type: 'auth:token'; token: string }
  | { type: 'device:select'; deviceId: string }
  | { type: 'agent:trigger_auth'; payload: { deviceId: string } }
  | { type: 'agent:prompt'; payload: AgentRunOptions }
  | { type: 'agent:abort'; payload: { sessionId: string } }
  | { type: 'agent:queue_prompt'; payload: { sessionId: string; prompt: string } }
  | { type: 'agent:remove_queued_prompt'; payload: { sessionId: string; index: number } }
  | { type: 'agent:clear_queue'; payload: { sessionId: string } }
  | { type: 'sessions:force_sync'; payload: { sessionId: string } }
  | { type: 'terminal:exec'; payload: { commandId: string; deviceId: string; command: string; cwd?: string } }
  | { type: 'fs:tree'; payload: { deviceId: string; path?: string } }
  | { type: 'fs:read'; payload: { deviceId: string; path: string } }
  | { type: 'fs:write'; payload: { deviceId: string; path: string; content: string } }
  | { type: 'transcripts:list_local'; payload: { reqId: string; deviceId?: string } }
  | { type: 'transcripts:read_local'; payload: { reqId: string; filePath: string; deviceId?: string } };

export type HubToClientMessage =
  | { type: 'state:init'; payload: { devices: DeviceInfo[]; activeDeviceId?: string; sessions: ChatSession[]; activeSessionId?: string } }
  | { type: 'device:updated'; payload: DeviceInfo }
  | { type: 'device:status'; payload: { deviceId: string; status: 'online' | 'offline' } }
  | { type: 'agent:auth_url'; payload: { deviceId: string; url: string } }
  | { type: 'agent:auth_success'; payload: { deviceId: string } }
  | { type: 'session:updated'; payload: ChatSession }
  | { type: 'session:deleted'; payload: { sessionId: string } }
  | { type: 'agent:chunk'; payload: { sessionId: string; chunk: string; delta?: string } }
  | { type: 'agent:tool_call'; payload: { sessionId: string; toolCall: ToolCallItem } }
  | { type: 'agent:tool_result'; payload: { sessionId: string; toolCallId: string; result: string; status: 'completed' | 'failed' } }
  | { type: 'agent:complete'; payload: { sessionId: string; success: boolean; error?: string } }
  | { type: 'terminal:output'; payload: { commandId: string; data: string; isError?: boolean } }
  | { type: 'terminal:exit'; payload: { commandId: string; code: number } }
  | { type: 'fs:tree'; payload: { tree: FileEntry[]; rootPath: string } }
  | { type: 'fs:file'; payload: { path?: string; content: string; error?: string } }
  | { type: 'transcripts:list_result'; payload: { reqId?: string; transcripts: any[] } }
  | { type: 'transcripts:read_result'; payload: { reqId?: string; result: any } }
  | { type: 'error'; message: string };
