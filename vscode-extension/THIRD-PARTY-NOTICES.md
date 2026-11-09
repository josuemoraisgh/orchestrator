# Third-party software notices

## AI Memory

Orchestrator downloads and runs the official AI Memory release from
<https://github.com/akitaonrails/ai-memory>. AI Memory is Copyright (c) 2026
Fabio Akita and is licensed under the MIT License:

```text
MIT License

Copyright (c) 2026 Fabio Akita

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Orchestrator downloads the upstream release asset by its pinned URL and verifies
the SHA-256 digest in `upstream-releases.json` before extraction. The AI Memory
source and corresponding release are available from the upstream repository.

## ignore

Orchestrator bundles `ignore` 7.0.14 from
<https://github.com/kaelzhang/node-ignore> to match `.worktreeinclude` patterns
using `.gitignore` rules. It is licensed under the MIT License:

```text
Copyright (c) 2013 Kael Zhang <i@kael.me>, contributors
http://kael.me/

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Runtime dependencies and artifact inventory

The production dependency closure in the VSIX is generated from the locked
root dependencies and is recorded in `sbom.cdx.json` (CycloneDX 1.5). It
contains these npm packages:

| Package | Version | License | License file included in the VSIX |
| --- | --- | --- | --- |
| `ignore` | 7.0.14 | MIT | `extension/node_modules/ignore/LICENSE-MIT` |
| `proper-lockfile` | 4.1.2 | MIT | `extension/node_modules/proper-lockfile/LICENSE` |
| `graceful-fs` | 4.2.11 | ISC | `extension/node_modules/graceful-fs/LICENSE` |
| `retry` | 0.12.0 | MIT | `extension/node_modules/retry/License` |
| `signal-exit` | 3.0.7 | ISC | `extension/node_modules/signal-exit/LICENSE.txt` |
| `yauzl` | 3.4.0 | MIT | `extension/node_modules/yauzl/LICENSE` |
| `pend` | 1.2.0 | MIT | `extension/node_modules/pend/LICENSE` |

The complete license texts and attribution notices are shipped at those paths.
The VSIX archive inventory was checked against the SBOM; each of the seven
bundled production packages has its declared license and corresponding license
file in the artifact. Development-only packaging dependencies are excluded
from the runtime SBOM and VSIX.

The pinned Windows x64 AI Memory runtime is downloaded at installation time,
verified against the SHA-256 digest in `upstream-releases.json`, and listed as
an external runtime component in the SBOM. Its MIT license appears above. The
VSIX does not contain Lich source code, assets, or binaries; Lich is recorded
only in release metadata as a behavioral-reference/legacy-compatibility
project and is not installed by the default runtime.
