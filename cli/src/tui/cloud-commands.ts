import { CloudService } from '@/cloud/cloud-service';
import { TeamService } from '@/team/team-service';
import { WorkspaceService } from '@/team/workspace-service';
import { SyncEngine } from '@/cloud/sync-engine';
import { useTUIStore } from '@/tui/store';
import { createLogger } from '@/utils/logger';

const logger = createLogger('cloud-commands');

export interface CloudCommandContext {
  cloudService: CloudService;
  teamService: TeamService;
  workspaceService: WorkspaceService;
  syncEngine: SyncEngine;
}

/**
 * Handle cloud-related CLI commands
 */
export async function handleCloudCommand(
  input: string,
  context: CloudCommandContext
): Promise<{ handled: boolean; output: string }> {
  const store = useTUIStore();
  const parts = input.trim().split(/\s+/);
  const command = parts[0];
  const subcommand = parts[1];
  const args = parts.slice(2);

  if (command !== '/team' && command !== '/workspace' && command !== '/sync' && command !== '/macros') {
    return { handled: false, output: '' };
  }

  try {
    if (command === '/team') {
      return await handleTeamCommand(subcommand, args, context);
    } else if (command === '/workspace') {
      return await handleWorkspaceCommand(subcommand, args, context);
    } else if (command === '/sync') {
      return await handleSyncCommand(subcommand, args, context);
    } else if (command === '/macros') {
      return await handleMacrosCommand(subcommand, args, context);
    }
  } catch (error) {
    logger.error({ error }, 'Cloud command error');
    return { handled: true, output: `Error: ${error instanceof Error ? error.message : String(error)}` };
  }

  return { handled: false, output: '' };
}

/**
 * Handle /team commands
 */
async function handleTeamCommand(
  subcommand: string,
  args: string[],
  context: CloudCommandContext
): Promise<{ handled: boolean; output: string }> {
  const { teamService, cloudService } = context;

  switch (subcommand) {
    case 'login': {
      if (!cloudService.isAuthenticated()) {
        return {
          handled: true,
          output: 'GitHub OAuth flow not yet implemented. Use /team login in browser.',
        };
      }
      const user = await cloudService.getCurrentUser();
      return {
        handled: true,
        output: `Logged in as: ${user?.username || 'Unknown'}`,
      };
    }

    case 'create': {
      const name = args[0];
      if (!name) {
        return { handled: true, output: 'Usage: /team create <name>' };
      }
      const team = await teamService.createTeam(name);
      return { handled: true, output: team ? `Team created: ${team.name}` : 'Failed to create team' };
    }

    case 'list': {
      const teams = await teamService.listTeams();
      if (teams.length === 0) {
        return { handled: true, output: 'No teams found' };
      }
      const output = teams.map((t) => `  - ${t.name} (${t.id.slice(0, 8)})`).join('\n');
      return { handled: true, output: `Teams:\n${output}` };
    }

    case 'switch': {
      const teamId = args[0];
      if (!teamId) {
        return { handled: true, output: 'Usage: /team switch <team-id>' };
      }
      const success = await teamService.switchTeam(teamId);
      return {
        handled: true,
        output: success ? `Switched to team` : 'Team not found',
      };
    }

    case 'invite': {
      const email = args[0];
      if (!email) {
        return { handled: true, output: 'Usage: /team invite <email>' };
      }
      const success = await teamService.inviteToTeam(email);
      return {
        handled: true,
        output: success ? `Invited ${email} to team` : 'Failed to invite user',
      };
    }

    default:
      return {
        handled: true,
        output: 'Team commands: login, create, list, switch, invite',
      };
  }
}

/**
 * Handle /workspace commands
 */
async function handleWorkspaceCommand(
  subcommand: string,
  args: string[],
  context: CloudCommandContext
): Promise<{ handled: boolean; output: string }> {
  const { teamService, workspaceService } = context;
  const teamContext = teamService.getContext();

  if (!teamContext.currentTeam) {
    return { handled: true, output: 'Please select a team first: /team switch <team-id>' };
  }

  switch (subcommand) {
    case 'create': {
      const name = args[0];
      if (!name) {
        return { handled: true, output: 'Usage: /workspace create <name>' };
      }
      const workspace = await workspaceService.createWorkspace(teamContext.currentTeam.id, name);
      return {
        handled: true,
        output: workspace ? `Workspace created: ${workspace.name}` : 'Failed to create workspace',
      };
    }

    case 'list': {
      const workspaces = await workspaceService.getWorkspaces(teamContext.currentTeam.id);
      if (workspaces.length === 0) {
        return { handled: true, output: 'No workspaces found' };
      }
      const output = workspaces
        .map((w) => `  - ${w.name} (${w.id.slice(0, 8)})`)
        .join('\n');
      return { handled: true, output: `Workspaces:\n${output}` };
    }

    case 'switch': {
      const workspaceId = args[0];
      if (!workspaceId) {
        return { handled: true, output: 'Usage: /workspace switch <workspace-id>' };
      }
      workspaceService.switchWorkspace(workspaceId);
      return { handled: true, output: 'Switched to workspace' };
    }

    default:
      return {
        handled: true,
        output: 'Workspace commands: create, list, switch',
      };
  }
}

/**
 * Handle /sync commands
 */
async function handleSyncCommand(
  subcommand: string,
  args: string[],
  context: CloudCommandContext
): Promise<{ handled: boolean; output: string }> {
  const { syncEngine } = context;

  switch (subcommand) {
    case 'start': {
      syncEngine.startSync();
      return { handled: true, output: 'Sync started' };
    }

    case 'stop': {
      syncEngine.stopSync();
      return { handled: true, output: 'Sync stopped' };
    }

    case 'status': {
      const status = syncEngine.getStatus();
      const output = `
Sync Status:
  Online: ${status.isOnline ? 'Yes' : 'No'}
  Syncing: ${status.isSyncing ? 'Yes' : 'No'}
  Pending: ${status.pendingCount}
  Synced: ${status.syncedCount}
  Last Sync: ${new Date(status.lastSync).toLocaleString()}
      `.trim();
      return { handled: true, output };
    }

    case 'history': {
      const limit = args[0] ? parseInt(args[0]) : 10;
      const history = syncEngine.getHistory(limit);
      if (history.length === 0) {
        return { handled: true, output: 'No sync history' };
      }
      const output = history
        .map((h) => `  - ${h.action} ${h.resource_type} (${new Date(h.timestamp).toLocaleString()})`)
        .join('\n');
      return { handled: true, output: `Sync History:\n${output}` };
    }

    default:
      return {
        handled: true,
        output: 'Sync commands: start, stop, status, history',
      };
  }
}

/**
 * Handle /macros commands
 */
async function handleMacrosCommand(
  subcommand: string,
  args: string[],
  context: CloudCommandContext
): Promise<{ handled: boolean; output: string }> {
  const { workspaceService } = context;

  switch (subcommand) {
    case 'share': {
      const name = args[0];
      const commands = args.slice(1).join(' ');
      if (!name || !commands) {
        return { handled: true, output: 'Usage: /macros share <name> <commands>' };
      }
      const macro = await workspaceService.shareMacro(name, commands);
      return {
        handled: true,
        output: macro ? `Macro shared: ${macro.name}` : 'Failed to share macro',
      };
    }

    case 'list': {
      const macros = await workspaceService.getSharedMacros();
      if (macros.length === 0) {
        return { handled: true, output: 'No shared macros' };
      }
      const output = macros.map((m) => `  - ${m.name} (${m.tags.join(', ')})`).join('\n');
      return { handled: true, output: `Shared Macros:\n${output}` };
    }

    default:
      return {
        handled: true,
        output: 'Macro commands: share, list',
      };
  }
}
