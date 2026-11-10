/* Sealed Fortune - demo + Sepolia frontend logic.
 *
 * DEMO MODE (default, no wallet needed):
 * The winning number is generated in this browser tab and kept
 * in a JS variable that is never shown on screen until reveal.
 * That is a *simulation* of the on-chain game - it lets anyone
 * play immediately. It is NOT FHE: the real confidentiality
 * happens only in the Solidity contract on Sepolia, where the
 * secret is an euint32 that nobody can read before reveal.
 * The demo is honest about this everywhere it appears.
 *
 * SEPOLIA MODE:
 * When CONTRACT_ADDRESS is set in config.js and MetaMask is
 * connected, "Connect wallet" enables the Sepolia panel.
 * A guess is encrypted in the browser with
 * @zama-fhe/relayer-sdk, sent as externalEuint32 + inputProof
 * to play(), and after revealRound() the secret / win flags are
 * publicly decrypted with the Relayer SDK. See sepoliaPlay()
 * and sepoliaReveal() - they are wired to the contract ABI in
 * abi.js and fail loudly (not silently) if the contract is not
 * deployed yet.
 */
const CFG = window.SEALED_FORTUNE_CONFIG || {};
const MIN = CFG.MIN_NUMBER || 1;
const MAX = CFG.MAX_NUMBER || 100;

// ---------- Demo state ----------
let demo = null; // { secret, players: [{name, guess, sealed}], revealed }
let demoRound = 0;

const $ = (id) => document.getElementById(id);
const demoNames = ["Ada", "Chidi", "Fatima", "Tunde", "Zainab"];

function fakeCiphertext(n) {
  // A visual stand-in for a ciphertext handle - NOT real encryption.
  let h = 0;
  const s = "sealed:" + n + ":" + Math.random();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "0x" + h.toString(16).padStart(8, "0") + "…" + Math.floor(Math.random() * 1e6).toString(16);
}

function startDemoRound() {
  demoRound += 1;
  demo = {
    secret: MIN + Math.floor(Math.random() * (MAX - MIN + 1)),
    players: [],
    revealed: false,
  };
  // Three simulated opponents seal guesses too, so reveal is interesting.
  demoNames.slice(0, 3).forEach((name) => {
    demo.players.push({
      name,
      guess: MIN + Math.floor(Math.random() * (MAX - MIN + 1)),
      sealed: true,
    });
  });
  renderDemo();
  setStatus("Round " + demoRound + " open - the winning number is sealed. Nobody can see it, not even you.");
}

function sealDemoGuess() {
  if (!demo || demo.revealed) { setStatus("Start a round first."); return; }
  const value = parseInt($("guessInput").value, 10);
  if (!Number.isInteger(value) || value < MIN || value > MAX) {
    setStatus("Pick a whole number from " + MIN + " to " + MAX + ".");
    return;
  }
  if (demo.players.some((p) => p.name === "You")) {
    setStatus("You already sealed a guess this round - one guess per player, like on-chain.");
    return;
  }
  demo.players.push({ name: "You", guess: value, sealed: true });
  renderDemo();
  setStatus("Your guess is sealed 🔒 - it is hidden until reveal. (Demo: simulated sealing, see note.)");
}

function revealDemo() {
  if (!demo) { setStatus("Start a round first."); return; }
  if (demo.revealed) { setStatus("Already revealed."); return; }
  demo.revealed = true;
  renderDemo();
  const winners = demo.players.filter((p) => p.guess === demo.secret);
  setStatus(
    winners.length
      ? "🎉 Winning number was " + demo.secret + " - winner" + (winners.length > 1 ? "s" : "") + ": " + winners.map((w) => w.name).join(", ") + "!"
      : "Winning number was " + demo.secret + " - no winner this round. Start a new round and try again."
  );
}

function renderDemo() {
  const box = $("demoPlayers");
  if (!demo) { box.innerHTML = "<p class='muted'>No round yet. Press “Start a round”.</p>"; $("demoSecret").textContent = "-"; return; }
  $("demoSecret").textContent = demo.revealed ? String(demo.secret) : "🔒 sealed";
  $("demoRoundLabel").textContent = "Round " + demoRound + (demo.revealed ? " - revealed" : " - open");
  box.innerHTML = demo.players.map((p) => {
    const won = demo.revealed && p.guess === demo.secret;
    const shown = demo.revealed ? String(p.guess) : fakeCiphertext(p.guess);
    return `<div class="player ${won ? "winner" : ""}">
      <strong>${p.name}</strong>
      <span>${demo.revealed ? "guess: " + shown : "sealed: " + shown}</span>
      <span>${demo.revealed ? (won ? "🏆 WINNER" : "-") : "🔒 hidden"}</span>
    </div>`;
  }).join("");
}

function setStatus(msg) { $("status").textContent = msg; }

// ---------- Sepolia (real FHE) ----------
// Wired end-to-end against the deployed contract on Sepolia.
// Flow: connect wallet -> refresh round -> seal guess (encrypted
// in-browser with @zama-fhe/relayer-sdk) -> reveal after deadline
// -> publicly decrypt secret + win flags with the Relayer.
// Demo mode above is untouched and stays a clearly-labelled
// simulation; nothing here touches demo state.
//
// Libraries (vendored, no CDN needed):
//   vendor/ethers.umd.min.js  -> window.ethers (ethers v6 UMD)
//   vendor/relayer-sdk-js.js  -> ESM bundle (@zama-fhe/relayer-sdk
//     0.4.1) + tfhe_bg.wasm / kms_lib_bg.wasm in the same folder.
//     Loaded lazily with dynamic import(), so if the SDK fails to
//     load, demo mode still works and Sepolia just reports the error.
// The SDK's own SepoliaConfig carries the relayer URL and the
// Sepolia ACL/KMS/verifier addresses; config.js RELAYER_URL is
// kept only as a human-readable note.

const SEPOLIA_CHAIN_ID = CFG.CHAIN_ID || 11155111;
const ETHERSCAN = "https://sepolia.etherscan.io";

let sepolia = null; // { provider, signer, contract, account, instance }
let sepoliaRoundId = null;

function setSepoliaStatus(msg) { $("sepoliaStatus").textContent = msg; }
function txLink(hash) { return ETHERSCAN + "/tx/" + hash; }

function shortAddr(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; }

function friendlyError(e) {
  const msg = (e && (e.shortMessage || e.reason || e.message)) || String(e);
  if (/user rejected|User denied|ACTION_REJECTED|4001/i.test(msg)) return "Transaction rejected in your wallet - nothing was sent.";
  if (/Already played/i.test(msg)) return "You already sealed a guess in this round - one guess per player.";
  if (/Round is closed/i.test(msg)) return "This round is closed - its deadline passed. Start a new round on Sepolia.";
  if (/Round already revealed/i.test(msg)) return "This round was already revealed.";
  if (/Too early to reveal/i.test(msg)) return "Too early to reveal - wait until the round deadline.";
  if (/Round does not exist/i.test(msg)) return "That round does not exist yet - start a round on Sepolia first.";
  if (/insufficient funds/i.test(msg)) return "Not enough Sepolia test ETH for gas - top up from a Sepolia faucet.";
  if (/network|chain|wrong chain/i.test(msg)) return "Wrong network - switch your wallet to Sepolia (chain 11155111). " + msg;
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

function requireSepolia() {
  if (!CFG.CONTRACT_ADDRESS) { setSepoliaStatus("Sepolia is not wired up yet: no contract address in config.js."); return null; }
  if (!sepolia || !sepolia.contract) { setSepoliaStatus("Connect your wallet first."); return null; }
  return sepolia;
}

async function ensureChain() {
  const chainHex = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(chainHex, 16) === SEPOLIA_CHAIN_ID) return true;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + SEPOLIA_CHAIN_ID.toString(16) }],
    });
    return true;
  } catch (e) {
    setSepoliaStatus("Please switch your wallet to Sepolia (chain ID 11155111) and try again. Your wallet refused the automatic switch.");
    return false;
  }
}

async function connectWallet() {
  if (!window.ethereum) { setStatus("No wallet found - install MetaMask or Rabby in your browser, then try again."); return; }
  if (!window.ethers) { setStatus("ethers library failed to load - reload the page (vendor/ethers.umd.min.js must be served with the page)."); return; }
  if (!CFG.CONTRACT_ADDRESS) {
    setStatus("Sepolia is not wired up yet: deploy the contract first, then paste its address into frontend/config.js (see README).");
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!(await ensureChain())) return;
    const provider = new window.ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new window.ethers.Contract(CFG.CONTRACT_ADDRESS, window.SEALED_FORTUNE_ABI, signer);
    sepolia = { provider, signer, contract, account: accounts[0], instance: null };
    $("walletLabel").textContent = "Connected: " + shortAddr(accounts[0]) + " (Sepolia)";
    $("sepoliaPanel").classList.remove("hidden");
    $("contractLabel").textContent = CFG.CONTRACT_ADDRESS;
    $("contractLabel").innerHTML = '<a href="' + ETHERSCAN + "/address/" + CFG.CONTRACT_ADDRESS + '" target="_blank" rel="noopener">' + CFG.CONTRACT_ADDRESS + "</a>";
    setSepoliaStatus("Wallet connected. Loading the latest round from Sepolia…");
    await refreshSepolia();
  } catch (e) {
    setSepoliaStatus("Wallet connection failed: " + friendlyError(e));
  }
}

async function getRelayerInstance() {
  if (sepolia.instance) return sepolia.instance;
  setSepoliaStatus("Loading the Zama Relayer SDK (first use takes a few seconds)…");
  let sdk;
  try {
    sdk = await import("./vendor/relayer-sdk-js.js");
  } catch (e) {
    throw new Error("Relayer SDK failed to load - vendor/relayer-sdk-js.js (and its .wasm files) must be served with the page. " + (e.message || e));
  }
  await sdk.initSDK();
  sepolia.instance = await sdk.createInstance({
    ...sdk.SepoliaConfig,
    network: window.ethereum,
    chainId: SEPOLIA_CHAIN_ID,
  });
  return sepolia.instance;
}

async function refreshSepolia() {
  const s = requireSepolia();
  if (!s) return;
  try {
    const nextId = await s.contract.nextRoundId();
    if (nextId === 0n) {
      sepoliaRoundId = null;
      $("sepoliaRoundLabel").textContent = "No round on Sepolia yet";
      $("sepoliaInfo").textContent = "Press “Start a round on Sepolia” to open round 0.";
      $("sepoliaResult").textContent = "";
      setSepoliaStatus("No round yet - start one on Sepolia.");
      return;
    }
    sepoliaRoundId = Number(nextId - 1n);
    const r = await s.contract.rounds(sepoliaRoundId);
    const revealAfter = new Date(Number(r.revealAfter) * 1000);
    const played = await s.contract.hasPlayed(sepoliaRoundId, s.account);
    const players = await s.contract.getPlayers(sepoliaRoundId);
    const now = Date.now();
    const open = !r.revealed && now < Number(r.revealAfter) * 1000;
    $("sepoliaRoundLabel").textContent =
      "Round " + sepoliaRoundId + (r.revealed ? " - revealed" : open ? " - open" : " - closed, awaiting reveal");
    $("sepoliaInfo").textContent =
      "Players: " + r.playerCount + " · Reveal after: " + revealAfter.toLocaleString() +
      (r.revealed ? " · already revealed" : open ? " · you " + (played ? "already played" : "have not played yet") : " · deadline passed, ready to reveal") +
      " · Players so far: " + players.map(shortAddr).join(", ");
    setSepoliaStatus(
      r.revealed ? "Round revealed - press “Reveal on Sepolia” to decrypt the result."
      : open ? (played ? "Your guess is sealed 🔒 - wait for the reveal." : "Round is open - seal your guess (1-100) above.")
      : "Deadline passed - anyone can reveal this round now."
    );
  } catch (e) {
    setSepoliaStatus("Could not read the round from Sepolia: " + friendlyError(e));
  }
}

async function startSepoliaRound() {
  const s = requireSepolia();
  if (!s) return;
  try {
    setSepoliaStatus("Starting a round on Sepolia - confirm in your wallet…");
    const tx = await s.contract.startRound();
    setSepoliaStatus("Round tx sent: " + tx.hash + " - waiting for confirmation…");
    await tx.wait();
    setSepoliaStatus("Round started ✅ - tx " + tx.hash);
    $("sepoliaResult").innerHTML = 'Round tx: <a href="' + txLink(tx.hash) + '" target="_blank" rel="noopener">' + tx.hash + "</a>";
    await refreshSepolia();
  } catch (e) {
    setSepoliaStatus("Could not start a round: " + friendlyError(e));
  }
}

async function sepoliaPlay() {
  const s = requireSepolia();
  if (!s) return;
  const value = parseInt($("guessInput").value, 10);
  if (!Number.isInteger(value) || value < MIN || value > MAX) {
    setSepoliaStatus("Pick a whole number from " + MIN + " to " + MAX + " first (same box as demo mode).");
    return;
  }
  try {
    await refreshSepolia();
    if (sepoliaRoundId === null) { setSepoliaStatus("No round on Sepolia yet - start one first."); return; }
    const r = await s.contract.rounds(sepoliaRoundId);
    if (r.revealed) { setSepoliaStatus("Round " + sepoliaRoundId + " was already revealed - start a new round."); return; }
    if (Date.now() >= Number(r.revealAfter) * 1000) { setSepoliaStatus("Round " + sepoliaRoundId + " is closed - its deadline passed. Start a new round."); return; }
    if (await s.contract.hasPlayed(sepoliaRoundId, s.account)) {
      setSepoliaStatus("You already sealed a guess in round " + sepoliaRoundId + " - one guess per player.");
      return;
    }
    const instance = await getRelayerInstance();
    setSepoliaStatus("Encrypting your guess (" + value + ") in your browser…");
    const input = instance.createEncryptedInput(CFG.CONTRACT_ADDRESS, s.account);
    input.add32(value);
    const { handles, inputProof } = await input.encrypt();
    setSepoliaStatus("Guess encrypted 🔒 - sending to the contract. Confirm in your wallet…");
    const tx = await s.contract.play(sepoliaRoundId, handles[0], inputProof);
    setSepoliaStatus("Guess tx sent: " + tx.hash + " - waiting for confirmation…");
    const receipt = await tx.wait();
    if (receipt.status !== 1n && receipt.status !== 1) throw new Error("Transaction failed on-chain (status 0).");
    $("sepoliaResult").innerHTML = 'Guess sealed ✅ - tx: <a href="' + txLink(tx.hash) + '" target="_blank" rel="noopener">' + tx.hash + "</a>";
    setSepoliaStatus("Your guess is sealed on Sepolia 🔒 - nobody can see it until reveal. (Round " + sepoliaRoundId + ")");
    await refreshSepolia();
  } catch (e) {
    setSepoliaStatus("Could not seal your guess: " + friendlyError(e));
  }
}

async function sepoliaReveal() {
  const s = requireSepolia();
  if (!s) return;
  try {
    await refreshSepolia();
    if (sepoliaRoundId === null) { setSepoliaStatus("No round on Sepolia yet."); return; }
    const r = await s.contract.rounds(sepoliaRoundId);
    if (!r.revealed) {
      if (Date.now() < Number(r.revealAfter) * 1000) {
        setSepoliaStatus("Too early to reveal - round " + sepoliaRoundId + " reveals after " + new Date(Number(r.revealAfter) * 1000).toLocaleString() + ".");
        return;
      }
      setSepoliaStatus("Revealing round " + sepoliaRoundId + " on-chain - confirm in your wallet…");
      const tx = await s.contract.revealRound(sepoliaRoundId);
      setSepoliaStatus("Reveal tx sent: " + tx.hash + " - waiting for confirmation…");
      await tx.wait();
      $("sepoliaResult").innerHTML = 'Reveal tx: <a href="' + txLink(tx.hash) + '" target="_blank" rel="noopener">' + tx.hash + "</a>";
    }
    // Decrypt: secret + every player's guess and win flag are now
    // publicly decryptable. Handles are read from the contract, then
    // publicDecrypt() returns clear values keyed by handle.
    setSepoliaStatus("Decrypting the secret and win flags with the Relayer…");
    const instance = await getRelayerInstance();
    const secretHandle = await s.contract.getSecret(sepoliaRoundId);
    const players = await s.contract.getPlayers(sepoliaRoundId);
    const handles = [secretHandle];
    const guessHandles = [];
    const flagHandles = [];
    for (const p of players) {
      const g = await s.contract.getGuess(sepoliaRoundId, p);
      const f = await s.contract.getWinFlag(sepoliaRoundId, p);
      guessHandles.push(g); flagHandles.push(f);
      handles.push(g, f);
    }
    const { clearValues } = await instance.publicDecrypt(handles);
    const secret = clearValues[secretHandle.toLowerCase()] ?? clearValues[secretHandle];
    const lines = players.map((p, i) => {
      const g = clearValues[guessHandles[i].toLowerCase()] ?? clearValues[guessHandles[i]];
      const w = clearValues[flagHandles[i].toLowerCase()] ?? clearValues[flagHandles[i]];
      return shortAddr(p) + ": guess " + String(g) + (w === true ? " 🏆 WINNER" : " -");
    });
    const winners = players.filter((_, i) => {
      const w = clearValues[flagHandles[i].toLowerCase()] ?? clearValues[flagHandles[i]];
      return w === true;
    });
    $("sepoliaResult").innerHTML =
      "<strong>🎉 Winning number: " + String(secret) + "</strong><br>" +
      lines.join("<br>") +
      (winners.length ? "<br>Winners: " + winners.map(shortAddr).join(", ") : "<br>No winner this round.");
    setSepoliaStatus(
      "Round " + sepoliaRoundId + " revealed - winning number " + String(secret) +
      (winners.length ? ", winner(s): " + winners.map(shortAddr).join(", ") : ", no winner.") + "."
    );
    await refreshSepolia();
  } catch (e) {
    setSepoliaStatus("Could not reveal: " + friendlyError(e));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("startRoundBtn").addEventListener("click", startDemoRound);
  $("sealGuessBtn").addEventListener("click", sealDemoGuess);
  $("revealBtn").addEventListener("click", revealDemo);
  $("connectBtn").addEventListener("click", connectWallet);
  $("sepoliaPlayBtn").addEventListener("click", sepoliaPlay);
  $("sepoliaRevealBtn").addEventListener("click", sepoliaReveal);
  $("sepoliaRefreshBtn").addEventListener("click", refreshSepolia);
  $("sepoliaStartBtn").addEventListener("click", startSepoliaRound);
  if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => { sepolia = null; setSepoliaStatus("Wallet account changed - connect again."); });
    window.ethereum.on("chainChanged", () => { sepolia = null; setSepoliaStatus("Network changed - connect again on Sepolia."); });
  }
  renderDemo();
});
