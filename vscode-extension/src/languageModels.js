const vscode = require('vscode');

async function selectChatModels(timeoutMs = 2500) {
  try {
    const request = vscode.lm.selectChatModels().then(
      models => ({ models, timedOut: false }),
      error => ({ models: [], timedOut: false, error })
    );
    const timeout = new Promise(resolve => {
      const timer = setTimeout(() => resolve({ models: [], timedOut: true }), timeoutMs);
      timer.unref?.();
    });
    return await Promise.race([request, timeout]);
  } catch (error) {
    return { models: [], timedOut: false, error };
  }
}

module.exports = { selectChatModels };
