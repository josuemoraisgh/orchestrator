const fs = require('node:fs/promises');
const path = require('node:path');

const targets = [
  {
    key: 'lich',
    repo: 'lichdotdev/lich',
    asset: tag => `lich-${tag}-windows-amd64.zip`
  },
  {
    key: 'aiMemory',
    repo: 'akitaonrails/ai-memory',
    asset: () => 'ai-memory-windows-x86_64.zip'
  }
];

async function latestRelease(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'orchestrator-ai-release-builder'
    }
  });
  if (!response.ok) throw new Error(`GitHub release lookup failed for ${repo}: HTTP ${response.status}`);
  const release = await response.json();
  if (release.draft || release.prerelease || !release.tag_name) throw new Error(`${repo} did not return a stable published release.`);
  return release;
}

async function main() {
  const output = {};
  for (const target of targets) {
    const release = await latestRelease(target.repo);
    const name = target.asset(release.tag_name);
    const asset = (release.assets || []).find(item => item.name === name);
    if (!asset || !asset.browser_download_url) throw new Error(`${target.repo}@${release.tag_name} has no required asset ${name}.`);
    const digest = String(asset.digest || '');
    if (!/^sha256:[a-f0-9]{64}$/i.test(digest)) throw new Error(`${target.repo}@${release.tag_name}/${name} has no GitHub-published SHA-256 digest.`);
    output[target.key] = {
      repository: target.repo,
      version: release.tag_name,
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
      windowsX64: {
        asset: name,
        url: asset.browser_download_url,
        sha256: digest.slice('sha256:'.length).toLowerCase(),
        sizeBytes: asset.size
      }
    };
    process.stdout.write(`${target.repo}: ${release.tag_name} (${name})\n`);
  }

  output.generatedAt = new Date().toISOString();
  const targetPath = path.resolve(__dirname, '..', 'upstream-releases.json');
  const temporaryPath = `${targetPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, targetPath);
  process.stdout.write(`Wrote ${targetPath}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
