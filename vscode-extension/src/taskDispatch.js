'use strict';

async function requireTaskDispatch(started, stopSession) {
  if (started?.status !== 'failed') return started;

  const error = new Error(String(started.error || 'The agent adapter reported that task delivery failed.'));
  error.code = 'ORCHESTRATOR_AGENT_START_FAILED';
  if (started.worktreePath) error.worktreePath = started.worktreePath;
  if (started.worktree) error.worktreeBranch = started.worktree;

  if (started.sessionId && typeof stopSession === 'function') {
    try {
      const stopped = await stopSession({
        session: started.sessionId,
        projectPath: started.projectPath,
        worktreePath: started.worktreePath
      });
      if (stopped?.stopped === false || stopped?.error) {
        throw new Error(stopped.error || `The stop operation returned ${stopped.sessionState || 'not stopped'}.`);
      }
    } catch (stopError) {
      error.sessionId = started.sessionId;
      error.sessionName = started.sessionName || started.sessionId;
      error.projectPath = started.projectPath;
      error.sessionStopError = String(stopError?.message || stopError);
      error.message += ` The opened session could not be parked: ${error.sessionStopError}`;
    }
  }

  throw error;
}

module.exports = { requireTaskDispatch };
