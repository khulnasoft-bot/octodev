import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/utils/logger';

const logger = createLogger('cloud-service');

export interface CloudUser {
  id: string;
  email: string;
  username: string;
  avatar_url?: string;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: 'admin' | 'editor' | 'viewer';
  joined_at: string;
}

export interface Workspace {
  id: string;
  team_id: string;
  name: string;
  settings?: Record<string, any>;
  created_at: string;
}

export interface SharedMacro {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  commands: string;
  description?: string;
  tags: string[];
  version: number;
  created_at: string;
}

export interface AIPrompt {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  prompt_text: string;
  tags: string[];
  version: number;
  created_at: string;
}

/**
 * CloudService - Main abstraction layer for Supabase integration
 */
export class CloudService {
  private client: SupabaseClient;
  private authToken: string | null = null;
  private userId: string | null = null;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.client = createClient(supabaseUrl, supabaseKey);
    logger.debug('CloudService initialized');
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.authToken !== null && this.userId !== null;
  }

  /**
   * Set authentication token and user ID
   */
  setAuth(token: string, userId: string): void {
    this.authToken = token;
    this.userId = userId;
    this.client.auth.setSession({
      access_token: token,
      refresh_token: token,
      user: { id: userId } as any,
    });
    logger.info({ userId }, 'Authentication set');
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<CloudUser | null> {
    if (!this.userId) return null;

    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('id', this.userId)
      .single();

    if (error) {
      logger.error({ error }, 'Failed to fetch current user');
      return null;
    }

    return data as CloudUser;
  }

  /**
   * Create a new team
   */
  async createTeam(name: string, description?: string): Promise<Team | null> {
    if (!this.userId) {
      logger.warn('Cannot create team: not authenticated');
      return null;
    }

    const { data, error } = await this.client
      .from('teams')
      .insert([
        {
          name,
          description,
          owner_id: this.userId,
        },
      ])
      .select()
      .single();

    if (error) {
      logger.error({ error, name }, 'Failed to create team');
      return null;
    }

    logger.info({ teamId: data.id, name }, 'Team created');
    return data as Team;
  }

  /**
   * Get user's teams
   */
  async getTeams(): Promise<Team[]> {
    if (!this.userId) return [];

    const { data, error } = await this.client
      .from('teams')
      .select('*')
      .or(`owner_id.eq.${this.userId},id.in(
        select team_id from team_members where user_id = '${this.userId}'
      )`);

    if (error) {
      logger.error({ error }, 'Failed to fetch teams');
      return [];
    }

    return (data || []) as Team[];
  }

  /**
   * Get team members
   */
  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    const { data, error } = await this.client
      .from('team_members')
      .select('*')
      .eq('team_id', teamId);

    if (error) {
      logger.error({ error, teamId }, 'Failed to fetch team members');
      return [];
    }

    return (data || []) as TeamMember[];
  }

  /**
   * Invite user to team (by email)
   */
  async inviteToTeam(teamId: string, email: string): Promise<boolean> {
    if (!this.userId) return false;

    // Find user by email
    const { data: userData, error: userError } = await this.client
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (userError) {
      logger.warn({ email }, 'User not found');
      return false;
    }

    // Add to team
    const { error } = await this.client
      .from('team_members')
      .insert([
        {
          team_id: teamId,
          user_id: userData.id,
          role: 'editor',
        },
      ]);

    if (error) {
      logger.error({ error, teamId, email }, 'Failed to invite user');
      return false;
    }

    logger.info({ teamId, email }, 'User invited to team');
    return true;
  }

  /**
   * Create workspace in team
   */
  async createWorkspace(teamId: string, name: string): Promise<Workspace | null> {
    const { data, error } = await this.client
      .from('workspaces')
      .insert([
        {
          team_id: teamId,
          name,
        },
      ])
      .select()
      .single();

    if (error) {
      logger.error({ error, teamId, name }, 'Failed to create workspace');
      return null;
    }

    logger.info({ workspaceId: data.id, name }, 'Workspace created');
    return data as Workspace;
  }

  /**
   * Get team workspaces
   */
  async getWorkspaces(teamId: string): Promise<Workspace[]> {
    const { data, error } = await this.client
      .from('workspaces')
      .select('*')
      .eq('team_id', teamId);

    if (error) {
      logger.error({ error, teamId }, 'Failed to fetch workspaces');
      return [];
    }

    return (data || []) as Workspace[];
  }

  /**
   * Get shared macros in workspace
   */
  async getSharedMacros(workspaceId: string): Promise<SharedMacro[]> {
    const { data, error } = await this.client
      .from('shared_macros')
      .select('*')
      .eq('workspace_id', workspaceId);

    if (error) {
      logger.error({ error, workspaceId }, 'Failed to fetch macros');
      return [];
    }

    return (data || []) as SharedMacro[];
  }

  /**
   * Save shared macro to workspace
   */
  async saveSharedMacro(
    workspaceId: string,
    name: string,
    commands: string,
    description?: string,
    tags?: string[]
  ): Promise<SharedMacro | null> {
    if (!this.userId) return null;

    const { data, error } = await this.client
      .from('shared_macros')
      .insert([
        {
          workspace_id: workspaceId,
          owner_id: this.userId,
          name,
          commands,
          description,
          tags: tags || [],
        },
      ])
      .select()
      .single();

    if (error) {
      logger.error({ error, name }, 'Failed to save macro');
      return null;
    }

    logger.info({ macroId: data.id }, 'Macro saved');
    return data as SharedMacro;
  }

  /**
   * Get AI prompts in workspace
   */
  async getAIPrompts(workspaceId: string): Promise<AIPrompt[]> {
    const { data, error } = await this.client
      .from('ai_prompts')
      .select('*')
      .eq('workspace_id', workspaceId);

    if (error) {
      logger.error({ error, workspaceId }, 'Failed to fetch prompts');
      return [];
    }

    return (data || []) as AIPrompt[];
  }

  /**
   * Save AI prompt to workspace
   */
  async saveAIPrompt(
    workspaceId: string,
    name: string,
    promptText: string,
    tags?: string[]
  ): Promise<AIPrompt | null> {
    if (!this.userId) return null;

    const { data, error } = await this.client
      .from('ai_prompts')
      .insert([
        {
          workspace_id: workspaceId,
          owner_id: this.userId,
          name,
          prompt_text: promptText,
          tags: tags || [],
        },
      ])
      .select()
      .single();

    if (error) {
      logger.error({ error, name }, 'Failed to save prompt');
      return null;
    }

    logger.info({ promptId: data.id }, 'Prompt saved');
    return data as AIPrompt;
  }

  /**
   * Log sync action to audit trail
   */
  async logSyncAction(
    action: string,
    resourceType?: string,
    resourceId?: string,
    details?: Record<string, any>
  ): Promise<void> {
    if (!this.userId) return;

    const { error } = await this.client.from('sync_log').insert([
      {
        user_id: this.userId,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        details,
      },
    ]);

    if (error) {
      logger.error({ error }, 'Failed to log sync action');
    }
  }

  /**
   * Subscribe to real-time macro updates
   */
  subscribeToMacros(workspaceId: string, callback: (macro: SharedMacro) => void): void {
    this.client
      .from(`shared_macros:workspace_id=eq.${workspaceId}`)
      .on('*', (payload) => {
        callback(payload.new as SharedMacro);
      })
      .subscribe();
  }

  /**
   * Subscribe to real-time prompt updates
   */
  subscribeToPrompts(workspaceId: string, callback: (prompt: AIPrompt) => void): void {
    this.client
      .from(`ai_prompts:workspace_id=eq.${workspaceId}`)
      .on('*', (payload) => {
        callback(payload.new as AIPrompt);
      })
      .subscribe();
  }
}
