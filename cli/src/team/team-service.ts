import { CloudService, Team, TeamMember } from '@/cloud/cloud-service';
import { createLogger } from '@/utils/logger';

const logger = createLogger('team-service');

export interface TeamContext {
  currentTeam: Team | null;
  currentWorkspace: string | null;
  members: TeamMember[];
}

/**
 * TeamService - High-level team management operations
 */
export class TeamService {
  private cloudService: CloudService;
  private context: TeamContext = {
    currentTeam: null,
    currentWorkspace: null,
    members: [],
  };

  constructor(cloudService: CloudService) {
    this.cloudService = cloudService;
    logger.info('TeamService initialized');
  }

  /**
   * Get current team context
   */
  getContext(): TeamContext {
    return this.context;
  }

  /**
   * Create new team
   */
  async createTeam(name: string, description?: string): Promise<Team | null> {
    if (!this.cloudService.isAuthenticated()) {
      logger.warn('Cannot create team: not authenticated');
      return null;
    }

    const team = await this.cloudService.createTeam(name, description);
    if (team) {
      this.context.currentTeam = team;
      logger.info({ teamId: team.id }, 'Team created and set as current');
    }

    return team;
  }

  /**
   * Get user's teams
   */
  async listTeams(): Promise<Team[]> {
    const teams = await this.cloudService.getTeams();
    logger.info({ count: teams.length }, 'Teams listed');
    return teams;
  }

  /**
   * Switch to different team
   */
  async switchTeam(teamId: string): Promise<boolean> {
    const teams = await this.cloudService.getTeams();
    const team = teams.find((t) => t.id === teamId);

    if (!team) {
      logger.warn({ teamId }, 'Team not found');
      return false;
    }

    this.context.currentTeam = team;
    this.context.currentWorkspace = null; // Reset workspace

    // Load team members
    this.context.members = await this.cloudService.getTeamMembers(teamId);

    logger.info({ teamId }, 'Switched to team');
    return true;
  }

  /**
   * Invite user to current team
   */
  async inviteToTeam(email: string): Promise<boolean> {
    if (!this.context.currentTeam) {
      logger.warn('No current team selected');
      return false;
    }

    const success = await this.cloudService.inviteToTeam(this.context.currentTeam.id, email);

    if (success) {
      // Reload members
      this.context.members = await this.cloudService.getTeamMembers(
        this.context.currentTeam.id
      );
      logger.info({ email }, 'User invited to team');
    }

    return success;
  }

  /**
   * Get team members
   */
  async getTeamMembers(): Promise<TeamMember[]> {
    if (!this.context.currentTeam) {
      logger.warn('No current team selected');
      return [];
    }

    this.context.members = await this.cloudService.getTeamMembers(this.context.currentTeam.id);
    return this.context.members;
  }

  /**
   * Check user role in current team
   */
  getUserRole(): string {
    const user = this.context.members.find((m) => m.user_id === this.getCurrentUserId());
    return user?.role || 'viewer';
  }

  /**
   * Check if user can perform action
   */
  canPerformAction(action: string): boolean {
    const role = this.getUserRole();

    const permissions: Record<string, string[]> = {
      edit: ['admin', 'editor'],
      delete: ['admin'],
      invite: ['admin'],
      kick: ['admin'],
      view: ['admin', 'editor', 'viewer'],
    };

    return permissions[action]?.includes(role) || false;
  }

  /**
   * Get current user ID (from auth context)
   */
  private getCurrentUserId(): string {
    // This would be set from auth context
    return 'current-user-id';
  }
}
