import fs from 'fs';
import path from 'path';
import { FileEntry } from '../shared/types';

export class FsBridge {
  public static getTree(dirPath?: string, maxDepth = 2): { tree: FileEntry[]; rootPath: string } {
    const root = dirPath && fs.existsSync(dirPath) ? path.resolve(dirPath) : process.cwd();

    function scan(currentPath: string, currentDepth: number): FileEntry[] {
      if (currentDepth > maxDepth) return [];
      try {
        const items = fs.readdirSync(currentPath, { withFileTypes: true });
        const result: FileEntry[] = [];

        for (const item of items) {
          // Ignore heavy directories
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

  public static readFile(filePath: string): { content: string; error?: string } {
    try {
      if (!fs.existsSync(filePath)) {
        return { content: '', error: 'File not found' };
      }
      const stat = fs.statSync(filePath);
      if (stat.size > 2 * 1024 * 1024) {
        return { content: '', error: 'File too large to open (>2MB)' };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return { content };
    } catch (err: any) {
      return { content: '', error: err.message || 'Error reading file' };
    }
  }

  public static writeFile(filePath: string, content: string): { success: boolean; error?: string } {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error writing file' };
    }
  }
}
