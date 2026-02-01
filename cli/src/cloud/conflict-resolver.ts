import { createLogger } from '@/utils/logger';

const logger = createLogger('conflict-resolver');

export interface Conflict {
  id: string;
  resourceType: string;
  resourceId: string;
  local: Record<string, any>;
  remote: Record<string, any>;
  localTimestamp: number;
  remoteTimestamp: number;
}

export interface ResolutionStrategy {
  type: 'local' | 'remote' | 'merge' | 'manual';
  metadata?: Record<string, any>;
}

/**
 * ConflictResolver - Handle conflicts between local and cloud data
 */
export class ConflictResolver {
  /**
   * Detect conflicts between local and remote versions
   */
  static detectConflict(
    local: Record<string, any>,
    remote: Record<string, any>,
    localTimestamp: number,
    remoteTimestamp: number
  ): Conflict | null {
    // If same content, no conflict
    if (JSON.stringify(local) === JSON.stringify(remote)) {
      return null;
    }

    // If one is significantly newer, no conflict
    const timeDiff = Math.abs(localTimestamp - remoteTimestamp);
    if (timeDiff > 60000) {
      // More than 60 seconds difference
      logger.debug({ timeDiff }, 'Time-based resolution applicable');
      return null;
    }

    return {
      id: `${local.id || 'unknown'}:conflict:${Date.now()}`,
      resourceType: local.type || 'unknown',
      resourceId: local.id || 'unknown',
      local,
      remote,
      localTimestamp,
      remoteTimestamp,
    };
  }

  /**
   * Resolve conflict using specified strategy
   */
  static resolve(conflict: Conflict, strategy: ResolutionStrategy): Record<string, any> {
    switch (strategy.type) {
      case 'local':
        logger.info({ conflictId: conflict.id }, 'Resolved with local version');
        return conflict.local;

      case 'remote':
        logger.info({ conflictId: conflict.id }, 'Resolved with remote version');
        return conflict.remote;

      case 'merge':
        return this.mergeVersions(conflict);

      case 'manual':
        throw new Error('Manual resolution required - user must decide');

      default:
        // Default: last-write-wins
        const winner =
          conflict.remoteTimestamp > conflict.localTimestamp
            ? conflict.remote
            : conflict.local;
        logger.info(
          { conflictId: conflict.id, winner: winner === conflict.remote ? 'remote' : 'local' },
          'Resolved using last-write-wins'
        );
        return winner;
    }
  }

  /**
   * Merge two versions intelligently
   */
  private static mergeVersions(conflict: Conflict): Record<string, any> {
    const merged = { ...conflict.remote };

    // For macros and prompts, preserve both versions with metadata
    if (conflict.resourceType === 'macro' || conflict.resourceType === 'prompt') {
      merged.versions = [
        {
          ...conflict.local,
          source: 'local',
          timestamp: conflict.localTimestamp,
        },
        {
          ...conflict.remote,
          source: 'remote',
          timestamp: conflict.remoteTimestamp,
        },
      ];

      merged.merged = true;
      logger.info({ conflictId: conflict.id }, 'Resolved using smart merge');
    }

    return merged;
  }

  /**
   * Suggest best resolution strategy
   */
  static suggestStrategy(conflict: Conflict): ResolutionStrategy {
    // If content is very similar, merge
    const localContent = JSON.stringify(conflict.local).length;
    const remoteContent = JSON.stringify(conflict.remote).length;
    const similarity = Math.min(localContent, remoteContent) / Math.max(localContent, remoteContent);

    if (similarity > 0.8) {
      return { type: 'merge' };
    }

    // If time difference is small, manual resolution
    const timeDiff = Math.abs(conflict.localTimestamp - conflict.remoteTimestamp);
    if (timeDiff < 5000) {
      // Less than 5 seconds
      return { type: 'manual' };
    }

    // Default: last-write-wins
    return {
      type: conflict.remoteTimestamp > conflict.localTimestamp ? 'remote' : 'local',
    };
  }
}
