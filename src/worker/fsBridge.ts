import fs from 'fs';
import path from 'path';
import { FileEntry } from '../shared/types';

const SENSITIVE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'credentials.json',
  'service-account.json',
]);

export class FsBridge {
  private static normalize(p: string): string {
    return path.resolve(p);
  }

  /** True if `target` is `root` or a path inside `root` (Windows-safe). */
  public static isInsideRoot(target: string, root: string): boolean {
    const resolvedTarget = this.normalize(target);
    const resolvedRoot = this.normalize(root);
    const rel = path.relative(resolvedRoot, resolvedTarget);
    if (!rel) return true;
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    // Block path tricks like ".." segments already handled by relative(); reject NUL etc.
    return !resolvedTarget.includes('\0');
  }

  private static assertAllowed(filePath: string, workspaceRoot: string): string | null {
    if (!workspaceRoot) {
      return 'Workspace root is required';
    }
    const resolved = this.normalize(filePath);
    if (!this.isInsideRoot(resolved, workspaceRoot)) {
      return 'Access denied: path is outside the workspace';
    }
    const base = path.basename(resolved).toLowerCase();
    if (SENSITIVE_NAMES.has(base) || base.startsWith('.env.')) {
      return 'Access denied: sensitive file';
    }
    return null;
  }

  public static getTree(
    dirPath: string | undefined,
    maxDepth = 2,
    workspaceRoot?: string
  ): { tree: FileEntry[]; rootPath: string; error?: string } {
    const rootCandidate =
      dirPath && fs.existsSync(dirPath) ? this.normalize(dirPath) : this.normalize(dirPath || process.cwd());
    const allowedRoot = workspaceRoot ? this.normalize(workspaceRoot) : rootCandidate;

    if (workspaceRoot && !this.isInsideRoot(rootCandidate, allowedRoot)) {
      return { tree: [], rootPath: allowedRoot, error: 'Access denied: path is outside the workspace' };
    }

    const root = workspaceRoot ? (this.isInsideRoot(rootCandidate, allowedRoot) ? rootCandidate : allowedRoot) : rootCandidate;

    function scan(currentPath: string, currentDepth: number): FileEntry[] {
      if (currentDepth > maxDepth) return [];
      try {
        const items = fs.readdirSync(currentPath, { withFileTypes: true });
        const result: FileEntry[] = [];

        for (const item of items) {
          if (['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build'].includes(item.name)) {
            continue;
          }

          const full = path.join(currentPath, item.name);
          const isDir = item.isDirectory();

          const entry: FileEntry = {
            name: item.name,
            path: full,
            isDirectory: isDir,
          };

          if (isDir && currentDepth < maxDepth) {
            entry.children = scan(full, currentDepth + 1);
          } else if (!isDir) {
            try {
              const stat = fs.statSync(full);
              entry.size = stat.size;
            } catch {}
          }

          result.push(entry);
        }

        return result.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
      } catch (err) {
        console.error(`Error scanning ${currentPath}:`, err);
        return [];
      }
    }

    return {
      tree: scan(root, 1),
      rootPath: root,
    };
  }

  public static readFile(
    filePath: string,
    workspaceRoot?: string
  ): { content: string; size?: number; error?: string } {
    try {
      const root = workspaceRoot || process.cwd();
      const denied = this.assertAllowed(filePath, root);
      if (denied) {
        return { content: '', error: denied };
      }

      const resolved = this.normalize(filePath);
      if (!fs.existsSync(resolved)) {
        return { content: '', error: 'File not found' };
      }
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        return { content: '', error: 'Path is a directory' };
      }
      if (stat.size > 2 * 1024 * 1024) {
        return { content: '', error: 'File too large to open (>2MB)' };
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      return { content, size: Buffer.byteLength(content, 'utf-8') };
    } catch (err: any) {
      return { content: '', error: err.message || 'Error reading file' };
    }
  }

  public static writeFile(
    filePath: string,
    content: string,
    workspaceRoot?: string
  ): { success: boolean; error?: string } {
    try {
      const root = workspaceRoot || process.cwd();
      const denied = this.assertAllowed(filePath, root);
      if (denied) {
        return { success: false, error: denied };
      }

      const resolved = this.normalize(filePath);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolved, content, 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error writing file' };
    }
  }
}
