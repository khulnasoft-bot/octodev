import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { createLogger } from '@/utils/logger';
import { CloudService } from './cloud-service';

const logger = createLogger('sync-engine');

export interface SyncEvent {
  id: string;
  action: 'create' | 'update' | 'delete';
  resourceType: string;
  resourceId: string;
  data: Record<string, any>;
  timestamp: number;
  synced: boolean;
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSync: number;
  pendingCount: number;
  syncedCount: number;
}

/**
 * SyncEngine - Manages offline-first bidirectional sync with cloud
 */
export class SyncEngine extends EventEmitter {
  private cloudService: CloudService;
  private db: Database.Database;
  private isOnline: boolean = navigator?.onLine ?? true;
  private isSyncing: boolean = false;
  private syncIntervalId: NodeJS.Timeout | null = null;
  private lastSync: number = 0;

  constructor(cloudService: CloudService, dbPath: string = ':memory:') {
    super();
    this.cloudService = cloudService;
    this.db = new Database(dbPath);
    this.initializeDatabase();
    this.setupNetworkListeners();
    logger.info('SyncEngine initialized');
  }

  /**
   * Initialize local sync database
   */
  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        resourceType TEXT NOT NULL,
        resourceId TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        synced BOOLEAN DEFAULT 0,
        retries INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sync_history (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        resourceType TEXT NOT NULL,
        resourceId TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        status TEXT DEFAULT 'synced'
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON sync_queue(synced);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_timestamp ON sync_queue(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sync_history_timestamp ON sync_history(timestamp);
    `);

    logger.debug('Sync database initialized');
  }

  /**
   * Setup network connectivity listeners
   */
  private setupNetworkListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.onOnline());
      window.addEventListener('offline', () => this.onOffline());
    }
  }

  /**
   * Called when network comes online
   */
  private onOnline(): void {
    logger.info('Network online - starting sync');
    this.isOnline = true;
    this.emit('online');
    this.startSync();
  }

  /**
   * Called when network goes offline
   */
  private onOffline(): void {
    logger.warn('Network offline - queuing operations');
    this.isOnline = false;
    this.emit('offline');
    this.stopSync();
  }

  /**
   * Queue an operation for syncing
   */
  queueOperation(
    action: 'create' | 'update' | 'delete',
    resourceType: string,
    resourceId: string,
    data: Record<string, any>
  ): string {
    const id = `${resourceType}:${resourceId}:${Date.now()}`;
    const timestamp = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO sync_queue (id, action, resourceType, resourceId, data, timestamp, synced)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(id, action, resourceType, resourceId, JSON.stringify(data), timestamp);

    logger.debug({ id, action, resourceType }, 'Operation queued');
    this.emit('operation-queued', { id, action, resourceType });

    if (this.isOnline) {
      this.startSync();
    }

    return id;
  }

  /**
   * Start sync process
   */
  startSync(): void {
    if (this.isSyncing || !this.isOnline) return;

    this.isSyncing = true;
    this.emit('sync-start');

    this.syncIntervalId = setInterval(() => {
      this.performSync();
    }, 5000); // Sync every 5 seconds

    // Initial sync
    this.performSync();
  }

  /**
   * Stop sync process
   */
  stopSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    this.isSyncing = false;
    this.emit('sync-stop');
  }

  /**
   * Perform actual sync operation
   */
  private async performSync(): Promise<void> {
    try {
      // Get pending operations
      const stmt = this.db.prepare(`
        SELECT * FROM sync_queue WHERE synced = 0 ORDER BY timestamp ASC LIMIT 50
      `);

      const pending = stmt.all() as any[];

      if (pending.length === 0) {
        this.lastSync = Date.now();
        return;
      }

      logger.debug({ count: pending.length }, 'Syncing operations');

      for (const op of pending) {
        try {
          await this.syncOperation(op);

          // Mark as synced
          const updateStmt = this.db.prepare(`
            UPDATE sync_queue SET synced = 1 WHERE id = ?
          `);
          updateStmt.run(op.id);

          // Log to history
          const historyStmt = this.db.prepare(`
            INSERT INTO sync_history (id, action, resourceType, resourceId, timestamp, status)
            VALUES (?, ?, ?, ?, ?, 'synced')
          `);
          historyStmt.run(op.id, op.action, op.resourceType, op.resourceId, Date.now());

          this.emit('operation-synced', op);
          logger.debug({ id: op.id }, 'Operation synced');
        } catch (error) {
          const retries = (op.retries || 0) + 1;
          if (retries < 3) {
            // Retry
            const retryStmt = this.db.prepare(`
              UPDATE sync_queue SET retries = ? WHERE id = ?
            `);
            retryStmt.run(retries, op.id);
            logger.warn({ id: op.id, retries }, 'Operation sync failed, retrying');
          } else {
            // Give up
            const failStmt = this.db.prepare(`
              INSERT INTO sync_history (id, action, resourceType, resourceId, timestamp, status)
              VALUES (?, ?, ?, ?, ?, 'failed')
            `);
            failStmt.run(op.id, op.action, op.resourceType, op.resourceId, Date.now());
            logger.error({ id: op.id, error }, 'Operation sync failed permanently');
          }
        }
      }

      this.lastSync = Date.now();
      this.emit('sync-complete', { syncedCount: pending.length });
    } catch (error) {
      logger.error({ error }, 'Sync failed');
      this.emit('sync-error', error);
    }
  }

  /**
   * Sync a single operation
   */
  private async syncOperation(op: any): Promise<void> {
    const data = JSON.parse(op.data);

    switch (op.resourceType) {
      case 'macro':
        if (op.action === 'create' || op.action === 'update') {
          await this.cloudService.saveSharedMacro(
            data.workspaceId,
            data.name,
            data.commands,
            data.description,
            data.tags
          );
        }
        break;

      case 'prompt':
        if (op.action === 'create' || op.action === 'update') {
          await this.cloudService.saveAIPrompt(
            data.workspaceId,
            data.name,
            data.promptText,
            data.tags
          );
        }
        break;

      default:
        await this.cloudService.logSyncAction(op.action, op.resourceType, op.resourceId, data);
    }
  }

  /**
   * Get sync status
   */
  getStatus(): SyncStatus {
    const pendingStmt = this.db.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0');
    const { count: pendingCount } = pendingStmt.get() as any;

    const syncedStmt = this.db.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE synced = 1');
    const { count: syncedCount } = syncedStmt.get() as any;

    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      lastSync: this.lastSync,
      pendingCount,
      syncedCount,
    };
  }

  /**
   * Get sync history
   */
  getHistory(limit: number = 100): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_history ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  /**
   * Clear old sync history
   */
  clearOldHistory(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare('DELETE FROM sync_history WHERE timestamp < ?');
    const result = stmt.run(cutoff);
    return result.changes;
  }

  /**
   * Shutdown sync engine
   */
  shutdown(): void {
    this.stopSync();
    this.db.close();
    logger.info('SyncEngine shut down');
  }
}
