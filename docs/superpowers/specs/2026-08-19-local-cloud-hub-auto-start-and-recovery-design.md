# Design Spec: Local Cloud Hub & Worker Auto-Start and Self-Recovery

**Date:** 2026-08-19  
**Status:** Approved  
**Topic:** Always-on Auto-start & Self-recovery for AgentRemote Local Cloud Hub and Worker

---

## 1. Objective
Ensure that the local AgentRemote Cloud Hub server (and optional Worker daemon) runs continuously on the Windows host machine, starts automatically on system boot / user login, and automatically recovers (restarts with crash-backoff protection) if it fails or crashes.

---

## 2. Architecture & Components

### 2.1 Process Management (PM2)
We use **PM2** as the Node.js production process manager.
- **Configuration:** `ecosystem.config.js` in the project root.
- **Managed Applications:**
  1. `agentremote-hub`
     - Script: `dist/server/index.js`
     - Node Args: `--max-old-space-size=128`
     - Autorestart: `true`
     - Max Memory Restart: `150M`
     - Min Uptime: `5s`
     - Max Restarts: `50`
     - Exponential Backoff: `100ms` initial, factor: `2`
     - Out & Error Logs: `logs/hub-out.log`, `logs/hub-error.log`
     - Watch: `false`
     - Environment: `NODE_ENV: 'production'`
  2. `agentremote-worker`
     - Script: `dist/worker/index.js`
     - Autorestart: `true`
     - Max Memory Restart: `250M`
     - Min Uptime: `5s`
     - Max Restarts: `50`
     - Exponential Backoff: `100ms` initial, factor: `2`
     - Out & Error Logs: `logs/worker-out.log`, `logs/worker-error.log`
     - Watch: `false`
     - Environment: `NODE_ENV: 'production'`

### 2.2 Windows Auto-Startup & Recovery
To ensure automatic startup on Windows without intrusive terminal popups:
- Provide Windows automation scripts in `scripts/`:
  - `scripts/install-startup.ps1`: Registers a Windows Task in Task Scheduler (or Windows Startup Shortcut) to execute PM2 resurrection / startup upon user logon in the background.
  - `scripts/uninstall-startup.ps1`: Cleans up the registered task / startup shortcut.
  - `scripts/start-all.ps1`: Convenience PowerShell script to build and launch PM2 ecosystem.
  - `scripts/stop-all.ps1`: Convenience PowerShell script to stop PM2 ecosystem.
- Add PM2 and PM2 startup helpers to `devDependencies` (or global instructions) for reliable recovery.

### 2.3 npm Scripts Integration
Add convenient commands in `package.json`:
- `pm2:start`: Runs build and starts all processes via PM2 (`npm run build && pm2 start ecosystem.config.js`)
- `pm2:hub`: Starts only the Cloud Hub (`npm run build && pm2 start ecosystem.config.js --only agentremote-hub`)
- `pm2:worker`: Starts only the Worker (`npm run build && pm2 start ecosystem.config.js --only agentremote-worker`)
- `pm2:stop`: Stops all PM2 managed processes (`pm2 stop ecosystem.config.js`)
- `pm2:restart`: Restarts all processes (`pm2 restart ecosystem.config.js`)
- `pm2:logs`: Streams live logs (`pm2 logs`)
- `pm2:status`: Displays PM2 process status (`pm2 status`)
- `startup:install`: Runs PowerShell setup to register background auto-start on Windows login
- `startup:uninstall`: Unregisters background auto-start

---

## 3. Error Handling & Edge Cases
- **Crash Loops:** Handled by PM2 exponential backoff (`exp_backoff_restart_delay: 100`, `min_uptime: '5s'`, `max_restarts: 50`) to prevent CPU exhaustion if a fatal config or network issue occurs.
- **Memory Leaks:** `max_memory_restart` restarts processes cleanly if memory usage exceeds configured threshold.
- **Log Rotation / Size:** Process logs are isolated in `logs/` directory. `.gitignore` is updated to exclude `logs/` files.
- **Port Conflict / Zombie Processes:** `pm2 start` or restart handles process tracking via PID, avoiding zombie orphan processes.

---

## 4. Verification & Testing Plan
1. **Compilation & Config Validation:** Run `npm run build` and verify `ecosystem.config.js` syntax.
2. **PM2 Startup & Status Verification:** Start the hub with `npm run pm2:start` (or `npx pm2 start ecosystem.config.js`), check `npm run pm2:status`, and verify `http://localhost:3000/health` returns `status: ok`.
3. **Self-Recovery Test:** Send a crash / kill signal to the node process (e.g. `pm2 restart agentremote-hub` or terminating the PID) and verify PM2 automatically respawns it within seconds.
4. **Startup Scripts Test:** Run `scripts/install-startup.ps1` and verify the scheduled task or startup entry is created cleanly.
