# 🔒 Sealed Fortune — a confidential game on Zama FHEVM

**Zama Developer Program · Season 5 — Confidential Gaming**
Built by Moshood Sodiq Olasunkanmi ([@verrnny](https://x.com/verrnny) / [DrVerny](https://github.com/DrVerny))

**Deadline:** December 14, 2026, 11:59 PM UTC · **Prize pool:** $50,000 total in cUSDT
(1st $20,000, 2nd $12,000, 3rd $8,000, 4th–10th $1,428.57 each — per Zama's Season 5 page;
the launch post on X said 5,000 cUSDT, the official page says $50,000 total.)

## What the game is

**Sealed Fortune — Hidden Number / Mystery Box.**

1. Anyone starts a round. The winning number (1–100) is drawn **on-chain, encrypted** — nobody can see it.
2. Each player seals **one guess** (1–100). The guess is encrypted in their browser and stored encrypted on-chain. Nobody can see any guess.
3. Win / lose is computed **on encrypted data**: `FHE.eq(guess, secret)` — the contract never sees a plaintext guess or secret.
4. After the round deadline, anyone calls `revealRound()`. **Only then** does the winning number (and every win flag) become publicly decryptable through the Zama Relayer. The frontend shows the winning number and the winners.

One number, one sealed guess, one reveal moment. Easy to understand, replayable every round — and impossible on a transparent chain, where the winning number and every guess would be visible and the host could change the number after seeing the guesses.

## Why it only works with FHE

| What | On a transparent chain | Here (FHEVM) |
|---|---|---|
| Winning number | Visible in storage / mempool — players copy it | `euint32`, generated with `FHE.randEuint32()` — never plaintext |
| Guesses | Visible — players copy the leader | `externalEuint32` → `euint32`, encrypted in the browser |
| Win / lose | Computed on public numbers | `FHE.eq()` on encrypted values → encrypted `ebool` |
| Reveal | Nothing to reveal — everything was already public | `FHE.makePubliclyDecryptable()` — only after the deadline |

## Project structure

```
zama-confidential-game/
├── contracts/SealedFortune.sol   # The game. FHEVM, Solidity ^0.8.24
├── deploy/deploy.ts              # hardhat-deploy script
├── test/SealedFortune.test.ts    # Game-logic tests (mocked FHEVM env)
├── frontend/                     # Static, no-framework frontend
│   ├── index.html                # Playable demo + Sepolia panel
│   ├── styles.css
│   ├── app.js                    # Demo logic + Sepolia wiring
│   ├── abi.js                    # Contract ABI for the frontend
│   └── config.js                 # CONTRACT_ADDRESS goes here (after deploy)
├── hardhat.config.ts             # localhost + Sepolia (env vars only)
└── package.json
```

References used (read-only, not copied verbatim): Zama's
[fhevm-hardhat-template](https://github.com/zama-ai/fhevm-hardhat-template),
[gambling-dapp-template](https://github.com/zama-ai/gambling-dapp-template),
[Season 5 folder](https://github.com/zama-ai/developer-program/tree/main/season-5),
and the [Season 5 announcement](https://www.zama.org/post/zama-developer-program-mainnet-season-5-confidential-gaming).
The game code here is original; the template only informed the
Hardhat / `@fhevm/solidity` / `@zama-fhe/relayer-sdk` setup.
Note: the old `zama-fhe` package is deprecated — this project uses
`@zama-fhe/relayer-sdk`, as Zama's Season 5 page instructs.

## Run the frontend locally (no wallet, no cost)

```bash
cd frontend
python3 -m http.server 8000
# open http://localhost:8000
```

Or just open `frontend/index.html` in a browser. Demo mode needs
nothing else: Start a round → seal a guess (1–100) → Reveal.
Three simulated opponents seal guesses too. **Demo is a simulation:**
the secret is hidden in the page, not real FHE. Real confidentiality
happens only in the contract on Sepolia — the demo says so on screen.

## Run the contract locally

Prerequisites: Node.js 20+, npm.

```bash
npm install
npm run compile
npm test
```

## Deploy to Sepolia

1. Get Sepolia test ETH (free, no real money) from a Sepolia faucet,
   e.g. https://cloud.google.com/application/web3/faucet/ethereum/sepolia
   or https://sepoliafaucet.com — send test ETH to your deploy wallet.
2. Create a fresh deploy wallet (MetaMask). **Never use a wallet that
   holds real funds, and never put a private key in this repo.**
3. Set env vars locally (do not commit them):
   ```bash
   export INFURA_API_KEY="your-infura-key"   # or use the public RPC fallback in hardhat.config.ts
   export PRIVATE_KEY="0x..."                 # deploy wallet only
   export ETHERSCAN_API_KEY="..."             # optional, for verification
   ```
   Or use Hardhat vars as in the template: `npx hardhat vars set MNEMONIC`
   and `npx hardhat vars set INFURA_API_KEY`.
4. Deploy:
   ```bash
   npx hardhat deploy --network sepolia
   # verify (optional):
   npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
   ```
5. Paste the deployed address into `frontend/config.js` as
   `CONTRACT_ADDRESS`, then open the frontend, connect MetaMask
   (Sepolia network), and play for real: seal a guess, wait for
   the deadline, reveal.

## Submit to Zama

When the game is deployed and playable on Sepolia, submit via Zama's
form with the contract address + GitHub repo link:
https://forms.gle/ee8BKCzTLUYTibk8A

Getting started / Season 5 folder:
https://github.com/zama-ai/developer-program/tree/main/season-5

Key dates: office hours Nov 19, 2026 · mid-season check-in Nov 26, 2026 ·
community vote opens Dec 1, 2026 · **deadline Dec 14, 2026, 11:59 PM UTC** ·
winners Dec 18–31, 2026.

## Judging criteria — how this maps

| Criterion | How Sealed Fortune meets it |
|---|---|
| **Confidentiality** | The game only works because the data is encrypted: secret, guesses, and win flags are all encrypted until reveal. See the comments at the top of `SealedFortune.sol`. |
| **Game Design & Fun** | One hidden number, one sealed guess, a reveal — simple, tense, replayable. |
| **Playability & UX** | Demo plays with no wallet; Sepolia is connect → seal → reveal, with clear rules on the page. |
| **Ease of Onboarding** | This README + in-page instructions; no lengthy setup; no paid services. |

Judging process (per Zama): top 10 by a Zama internal committee,
then community vote on those 10.

## Honest limits / next steps

- **No real money in the contract.** This is a testnet game for points /
  bragging rights. No ETH / cUSDT is escrowed. A prize pool (e.g. a
  confidential cUSDT pot split between winners) is a natural next step
  — it needs a tested escrow + payout design, not a quick add-on.
- **Round length is fixed at 1 day** (`ROUND_DURATION`). Shorter rounds
  (e.g. 1 hour) would make demo / judging faster — a one-line change,
  worth doing before submission if judges need a quick reveal.
- **Frontend Sepolia wiring is ready but untested against a live
  deployment** — it needs the deployed address + a live Relayer SDK
  test before submission. The demo mode is fully playable now.
- **Tests pass locally: 5/5** (`npm test`, 2026-11-09) — round
  creation, one guess per player, no play on a missing round, no
  early reveal, and reveal after the deadline. A full encrypted
  win/lose assertion is deliberately not in the tests: the winning
  number is random and encrypted, so no test can know the right
  guess in advance — that is the confidentiality working as designed.
- **Known toolchain quirks (documented so the next build is faster):**
  Hardhat must be 2.28.6 (2.29 breaks the FHEVM plugin's
  `install-solidity` subtask) and `defaultNetwork` must be
  `"hardhat"` (with `"localhost"` the same subtask fails with
  HH312). `@zama-fhe/relayer-sdk@0.4.1` is deprecated in favour of
  `@zama-fhe/sdk`, but the plugin pins 0.4.1, so it stays for now.

## License

MIT — see LICENSE.
