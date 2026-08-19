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
  createdAt: number;
  updatedAt: number;
  cursorChatId?: string; // Cursor CLI native chat ID if linked
  workspacePath: string;
  model: string;
  mode: 'agent' | 'plan' | 'ask' | 'yolo';
  messages: ChatMessage[];
}

export interface ToolCallItem {
  id: string;
  type: string;
  name: string;
  input?: any;
  output?: string;
  status: 'running' | 'completed' | 'failed';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
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
  mode?: 'agent' | 'plan' | 'ask' | 'yolo';
  workspacePath?: string;
  cursorChatId?: string;
  continueLastSession?: boolean;
}

// WebSocket message types between Worker and Cloud Hub
export type WorkerToHubMessage =
  | { type: 'worker:register'; payload: DeviceInfo }
  | { type: 'worker:heartbeat'; payload: { deviceId: string; memoryUsage?: any; cpuUsage?: number } }
  | { type: 'agent:chunk'; payload: { sessionId: string; chunk: string; delta?: string } }
  | { type: 'agent:tool_call'; payload: { sessionId: string; toolCall: ToolCallItem } }
  | { type: 'agent:tool_result'; payload: { sessionId: string; toolCallId: string; result: string; status: 'completed' | 'failed' } }
  | { type: 'agent:complete'; payload: { sessionId: string; fullContent: string; cursorChatId?: string; success: boolean; error?: string } }
  | { type: 'agent:error'; payload: { sessionId: string; error: string } }
  | { type: 'terminal:output'; payload: { commandId: string; data: string; isError?: boolean } }
  | { type: 'terminal:exit'; payload: { commandId: string; code: number } }
  | { type: 'fs:tree_result'; payload: { reqId: string; tree: FileEntry[]; rootPath: string } }
  | { type: 'fs:file_result'; payload: { reqId: string; content: string; error?: string } }
  | { type: 'fs:write_result'; payload: { reqId: string; success: boolean; error?: string } }
  | { type: 'sessions:discovered'; payload: { deviceId: string; sessions: DiscoveredSession[] } };

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
  | { type: 'terminal:run'; payload: { commandId: string; command: string; cwd?: string } }
  | { type: 'terminal:kill'; payload: { commandId: string } }
  | { type: 'fs:get_tree'; payload: { reqId: string; path?: string; maxDepth?: number } }
  | { type: 'fs:read_file'; payload: { reqId: string; path: string } }
  | { type: 'fs:write_file'; payload: { reqId: string; path: string; content: string } }
  | { type: 'sessions:scan'; payload: { deviceId: string } };

// WebSocket message types between Client (Web IDE) and Cloud Hub
export type ClientToHubMessage =
  | { type: 'auth:token'; token: string }
  | { type: 'device:select'; deviceId: string }
  | { type: 'agent:prompt'; payload: AgentRunOptions }
  | { type: 'agent:abort'; payload: { sessionId: string } }
  | { type: 'terminal:exec'; payload: { commandId: string; deviceId: string; command: string; cwd?: string } }
  | { type: 'fs:tree'; payload: { deviceId: string; path?: string } }
  | { type: 'fs:read'; payload: { deviceId: string; path: string } }
  | { type: 'fs:write'; payload: { deviceId: string; path: string; content: string } };

export type HubToClientMessage =
  | { type: 'state:init'; payload: { devices: DeviceInfo[]; activeDeviceId?: string; sessions: ChatSession[]; activeSessionId?: string } }
  | { type: 'device:updated'; payload: DeviceInfo }
  | { type: 'device:status'; payload: { deviceId: string; status: 'online' | 'offline' } }
  | { type: 'session:updated'; payload: ChatSession }
  | { type: 'session:deleted'; payload: { sessionId: string } }
  | { type: 'agent:chunk'; payload: { sessionId: string; chunk: string; delta?: string } }
  | { type: 'agent:tool_call'; payload: { sessionId: string; toolCall: ToolCallItem } }
  | { type: 'agent:tool_result'; payload: { sessionId: string; toolCallId: string; result: string; status: 'completed' | 'failed' } }
  | { type: 'agent:complete'; payload: { sessionId: string; success: boolean; error?: string } }
  | { type: 'terminal:output'; payload: { commandId: string; data: string; isError?: boolean } }
  | { type: 'terminal:exit'; payload: { commandId: string; code: number } }
  | { type: 'fs:tree'; payload: { tree: FileEntry[]; rootPath: string } }
  | { type: 'fs:file'; payload: { path: string; content: string; error?: string } }
  | { type: 'error'; message: string };
