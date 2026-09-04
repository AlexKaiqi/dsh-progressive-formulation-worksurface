# Checkout verification

Verified on 2026-09-04. Every checkout is clean and matches the pinned revision
in `sources.lock.json`.

| Source | Revision | Working tree |
| --- | --- | --- |
| openai-codex | `8e6a44b428e31f91b21edc97904fcdf4f0931ade` | clean |
| letta-code | `feb32e33c4f4badd546e75b70ef202283d6580da` | clean |
| aigne-framework | `441f59b446182cdfc7462e1a16520a61dc40a5f9` | clean |
| agentplane | `fa693664b5fb4f7884b5c772b456357518732bd4` | clean |
| git-context-controller | `78e274e9f350dec75c236a0c0cc5f6f419df71b0` | clean |
| agentsfs | `cc5ab914e2bc1ce005a366045efe88ed96220069` | clean |
| agno-context | `417be08fa78bbc12df0704a68c2ac51dca4b123a` | clean |
| context-repository | `a531facaeb5c216fdc7e83f263c005955a954219` | clean |
| skillfoundry-harness | `4ac1cd7da888bdce12a4d545ca5948c63dc0ca4f` | clean |
| OpenHands Software Agent SDK | `07307cb8edfcd9b4675be2761df0646d075a9c36` | clean |
| Aider | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` | clean |
| Axiom `agent-memory` | `72075416ce23c67d1ae7f74a1274a96e01832abd` | clean |
| Memstead | `a0efe213329322180e42faa939e36f8ba765ccc4` | clean |
| ACE | `82709de050e1db6e6ef2f07bcb0393560b94992a` | clean |
| ContextFS | `1aaa3603e837461752519911514be28ce9327966` | clean |
| ACE Playbook | `97bdb158f72c7dfca73b581545172c981ea8dc88` | clean (sparse checkout avoids a case-colliding GitHub template pair) |
| LangChain Deep Agents | `632f2c941b877eff70407606b58e393212448a26` | clean (full history, blobless checkout; MIT `LICENSE` SHA-256 `4ec67e4ca6e6721dba849b2ca82261597c86a61ee214bbf21416006b7b2d0478`) |
| AICTX | `aa5efbd0e3f35f5a307b70556c4b931f89c4019e` | clean (full history, blobless checkout; MIT) |
| agent-mem | `0f51758dc6ed803f5322ca0b2e25689120a6d291` | clean |
| agent-os | `53897b7de5aa56af32dad44580c3515eb5c6733d` | clean |

The checkouts are research inputs, not dependencies. Their `.git` directories
were retained in the local audit workspace so every cited line could be tied to
its source revision; the checkouts themselves are not vendored in WorkSurface.
