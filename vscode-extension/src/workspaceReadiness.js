'use strict';

function canAutoInstallWorkspaceTools(workspace) {
  return Boolean(workspace?.isTrusted && Array.isArray(workspace.workspaceFolders) && workspace.workspaceFolders.length > 0);
}

module.exports = { canAutoInstallWorkspaceTools };
