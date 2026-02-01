import { CloudService, Workspace, SharedMacro, AIPrompt } from '@/cloud/cloud-service';
import { SyncEngine } from '@/cloud/sync-engine';
import { E2EEncryption } from '@/cloud/encryption';
import { createLogger } from '@/utils/logger';

const logger = createLogger('workspace-service');

/**
 * WorkspaceService - Manage workspace operations and resource sharing
 */
export class WorkspaceService {
  private cloudService: CloudService;
  private syncEngine: SyncEngine;
  private currentWorkspaceId: string | null = null;
  private encryptionKey: Buffer | null = null;

  constructor(cloudService: CloudService, syncEngine: SyncEngine) {
    this.cloudService = cloudService;
    this.syncEngine = syncEngine;
    logger.info('WorkspaceService initialized');
  }

  /**
   * Create workspace in team
   */
  async createWorkspace(teamId: string, name: string): Promise<Workspace | null> {
    const workspace = await this.cloudService.createWorkspace(teamId, name);

    if (workspace) {
      this.currentWorkspaceId = workspace.id;
      logger.info({ workspaceId: workspace.id }, 'Workspace created and set as current');
    }

    return workspace;
  }

  /**
   * Get workspaces in team
   */
  async getWorkspaces(teamId: string): Promise<Workspace[]> {
    const workspaces = await this.cloudService.getWorkspaces(teamId);
    logger.info({ count: workspaces.length }, 'Workspaces retrieved');
    return workspaces;
  }

  /**
   * Switch to workspace
   */
  switchWorkspace(workspaceId: string): void {
    this.currentWorkspaceId = workspaceId;
    logger.info({ workspaceId }, 'Switched to workspace');
  }

  /**
   * Get current workspace ID
   */
  getCurrentWorkspaceId(): string | null {
    return this.currentWorkspaceId;
  }

  /**
   * Share macro to workspace
   */
  async shareMacro(
    name: string,
    commands: string,
    description?: string,
    tags?: string[]
  ): Promise<SharedMacro | null> {
    if (!this.currentWorkspaceId) {
      logger.warn('No current workspace selected');
      return null;
    }

    // Encrypt commands if key is set
    let encryptedCommands = commands;
    if (this.encryptionKey) {
      encryptedCommands = E2EEncryption.encrypt(commands, this.encryptionKey);
    }

    const macro = await this.cloudService.saveSharedMacro(
      this.currentWorkspaceId,
      name,
      encryptedCommands,
      description,
      tags
    );

    if (macro) {
      // Queue for sync
      this.syncEngine.queueOperation('create', 'macro', macro.id, {
        name,
        commands: encryptedCommands,
        description,
        tags,
        workspaceId: this.currentWorkspaceId,
      });

      logger.info({ macroId: macro.id }, 'Macro shared to workspace');
    }

    return macro;
  }

  /**
   * Get shared macros in workspace
   */
  async getSharedMacros(): Promise<SharedMacro[]> {
    if (!this.currentWorkspaceId) {
      logger.warn('No current workspace selected');
      return [];
    }

    const macros = await this.cloudService.getSharedMacros(this.currentWorkspaceId);

    // Decrypt macros if key is set
    if (this.encryptionKey) {
      macros.forEach((macro) => {
        try {
          macro.commands = E2EEncryption.decrypt(macro.commands, this.encryptionKey!);
        } catch (error) {
          logger.warn({ macroId: macro.id }, 'Failed to decrypt macro');
        }
      });
    }

    logger.info({ count: macros.length }, 'Shared macros retrieved');
    return macros;
  }

  /**
   * Share AI prompt to workspace
   */
  async sharePrompt(
    name: string,
    promptText: string,
    tags?: string[]
  ): Promise<AIPrompt | null> {
    if (!this.currentWorkspaceId) {
      logger.warn('No current workspace selected');
      return null;
    }

    // Encrypt prompt if key is set
    let encryptedPrompt = promptText;
    if (this.encryptionKey) {
      encryptedPrompt = E2EEncryption.encrypt(promptText, this.encryptionKey);
    }

    const prompt = await this.cloudService.saveAIPrompt(
      this.currentWorkspaceId,
      name,
      encryptedPrompt,
      tags
    );

    if (prompt) {
      // Queue for sync
      this.syncEngine.queueOperation('create', 'prompt', prompt.id, {
        name,
        promptText: encryptedPrompt,
        tags,
        workspaceId: this.currentWorkspaceId,
      });

      logger.info({ promptId: prompt.id }, 'Prompt shared to workspace');
    }

    return prompt;
  }

  /**
   * Get shared AI prompts in workspace
   */
  async getSharedPrompts(): Promise<AIPrompt[]> {
    if (!this.currentWorkspaceId) {
      logger.warn('No current workspace selected');
      return [];
    }

    const prompts = await this.cloudService.getAIPrompts(this.currentWorkspaceId);

    // Decrypt prompts if key is set
    if (this.encryptionKey) {
      prompts.forEach((prompt) => {
        try {
          prompt.prompt_text = E2EEncryption.decrypt(prompt.prompt_text, this.encryptionKey!);
        } catch (error) {
          logger.warn({ promptId: prompt.id }, 'Failed to decrypt prompt');
        }
      });
    }

    logger.info({ count: prompts.length }, 'Shared prompts retrieved');
    return prompts;
  }

  /**
   * Set encryption key for E2E operations
   */
  setEncryptionKey(key: Buffer): void {
    this.encryptionKey = key;
    logger.info('Encryption key set for workspace');
  }

  /**
   * Subscribe to real-time updates
   */
  subscribeToUpdates(onMacroUpdate: (macro: SharedMacro) => void): void {
    if (this.currentWorkspaceId) {
      this.cloudService.subscribeToMacros(this.currentWorkspaceId, onMacroUpdate);
      this.cloudService.subscribeToPrompts(this.currentWorkspaceId, (prompt) => {
        // Decrypt before passing
        if (this.encryptionKey) {
          try {
            prompt.prompt_text = E2EEncryption.decrypt(prompt.prompt_text, this.encryptionKey);
          } catch (error) {
            logger.warn('Failed to decrypt prompt update');
          }
        }
      });
      logger.info('Subscribed to real-time updates');
    }
  }
}
