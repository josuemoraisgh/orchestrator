'use strict';

function resolveCoordinatorSettingsMode(providerId, profileId, providers = []) {
  const selectedProviderId = String(providerId || '');
  const requestedProfileId = String(profileId || '');
  const selectedProvider = providers.find(item => item.id === selectedProviderId && item.canCoordinateInOrchestratorChat);
  const cliProvider = providers.find(item => item.id === selectedProviderId && item.canCoordinateWithCli);
  if (selectedProviderId && !selectedProvider && !cliProvider) {
    throw new Error('Escolha um modelo do VS Code ou um perfil CLI autorizado para o coordenador.');
  }
  const mode = cliProvider ? 'cli' : 'vscode';
  return {
    mode,
    selectedProvider,
    // Retain a missing ID so the chat can offer its verified recovery flow.
    profileId: mode === 'cli' ? requestedProfileId : ''
  };
}

function resolveCoordinatorCli(orchestration = {}, profiles = [], providers = []) {
  if (orchestration.mode !== 'cli') return { ready: false, recoverable: false, profile: undefined, provider: undefined, message: '' };

  const providerId = String(orchestration.providerId || '');
  const provider = providers.find(item => item.id === providerId);
  if (!provider?.canCoordinateWithCli) {
    return {
      ready: false,
      recoverable: false,
      profile: undefined,
      provider,
      message: `${provider?.name || providerId || 'Agente CLI'}: a CLI compatível não está disponível neste ambiente. Confira a instalação e o PATH.`
    };
  }

  const profileId = String(orchestration.profileId || '');
  if (!profileId) {
    return {
      ready: false,
      recoverable: false,
      profile: undefined,
      provider,
      message: `${provider.name}: nenhum perfil foi selecionado para o coordenador. Abra Configurações e escolha um perfil autorizado.`
    };
  }

  const profile = profiles.find(item => item.id === profileId && item.providerId === providerId);
  if (!profile) {
    return {
      ready: false,
      recoverable: !profiles.some(item => item.id === profileId || item.providerId === providerId),
      profile: undefined,
      provider,
      message: `${provider.name}: o perfil selecionado não está cadastrado neste perfil do VS Code. Abra Configurações e cadastre ou autorize o perfil.`
    };
  }

  if (!profile.authorized) {
    return {
      ready: false,
      recoverable: false,
      profile,
      provider,
      message: `${provider.name}: o perfil selecionado está desautorizado. Abra Configurações e autorize o perfil.`
    };
  }

  return { ready: true, recoverable: false, profile, provider, message: '' };
}

module.exports = { resolveCoordinatorCli, resolveCoordinatorSettingsMode };
