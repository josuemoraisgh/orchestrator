'use strict';

async function recoverConfiguredCoordinatorProfile({
  providerId,
  profileId,
  profiles = [],
  providers = [],
  verifyCurrentLogin,
  confirmCurrentLogin,
  saveProfiles
}) {
  const id = String(profileId || '').trim();
  const providerKey = String(providerId || '').trim();
  if (!id || !providerKey) return { status: 'unavailable', message: 'Não há um perfil CLI selecionado para recuperar.' };

  const sameId = profiles.find(profile => profile.id === id);
  if (sameId) {
    return sameId.providerId === providerKey && sameId.authorized
      ? { status: 'ready', profile: sameId }
      : { status: 'unavailable', message: 'O ID selecionado já pertence a outro provedor ou está desautorizado. Confira Configurações.' };
  }
  if (profiles.some(profile => profile.providerId === providerKey)) {
    return { status: 'unavailable', message: 'Já existe outro perfil deste provedor. Selecione-o em Configurações para evitar trocar de conta automaticamente.' };
  }

  const provider = providers.find(item => item.id === providerKey && item.canCoordinateWithCli);
  if (!provider) return { status: 'unavailable', message: 'A CLI selecionada não está disponível para recuperar este perfil.' };
  if (typeof verifyCurrentLogin !== 'function' || typeof confirmCurrentLogin !== 'function' || typeof saveProfiles !== 'function') {
    return { status: 'unavailable', message: 'Não foi possível validar e recuperar o perfil CLI.' };
  }

  const profile = {
    id,
    providerId: providerKey,
    name: `${provider.name} · login atual da CLI`,
    isolated: false,
    authorized: true,
    maxParallel: 1,
    createdAt: Date.now()
  };
  const authentication = await verifyCurrentLogin(profile, provider);
  if (authentication?.status !== 'verified') {
    return { status: 'unauthenticated', message: authentication?.text || `${provider.name}: não foi possível verificar a sessão atual da CLI.` };
  }

  if (!await confirmCurrentLogin(provider, profile)) return { status: 'cancelled' };
  await saveProfiles([...profiles, profile]);
  return { status: 'recovered', profile, authentication };
}

module.exports = { recoverConfiguredCoordinatorProfile };
