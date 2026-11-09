'use strict';

function extensionStoragePath(context) {
  const value = context?.globalStorageUri?.fsPath;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('O VS Code não forneceu o caminho de armazenamento global da extensão. Feche e reabra esta janela do projeto e tente novamente.');
  }
  return value;
}

module.exports = { extensionStoragePath };
