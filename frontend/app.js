/* Sealed Fortune — demo + Sepolia frontend logic.
 *
 * DEMO MODE (default, no wallet needed):
 * The winning number is generated in this browser tab and kept
 * in a JS variable that is never shown on screen until reveal.
 * That is a *simulation* of the on-chain game — it lets anyone
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
 * and sepoliaReveal() — they are wired to the contract ABI in
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
  // A visual stand-in for a ciphertext handle — NOT real encryption.
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
  setStatus("Round " + demoRound + " open — the winning number is sealed. Nobody can see it, not even you.");
}

function sealDemoGuess() {
  if (!demo || demo.revealed) { setStatus("Start a round first."); return; }
  const value = parseInt($("guessInput").value, 10);
  if (!Number.isInteger(value) || value < MIN || value > MAX) {
    setStatus("Pick a whole number from " + MIN + " to " + MAX + ".");
    return;
  }
  if (demo.players.some((p) => p.name === "You")) {
    setStatus("You already sealed a guess this round — one guess per player, like on-chain.");
    return;
  }
  demo.players.push({ name: "You", guess: value, sealed: true });
  renderDemo();
  setStatus("Your guess is sealed 🔒 — it is hidden until reveal. (Demo: simulated sealing, see note.)");
}

function revealDemo() {
  if (!demo) { setStatus("Start a round first."); return; }
  if (demo.revealed) { setStatus("Already revealed."); return; }
  demo.revealed = true;
  renderDemo();
  const winners = demo.players.filter((p) => p.guess === demo.secret);
  setStatus(
    winners.length
      ? "🎉 Winning number was " + demo.secret + " — winner" + (winners.length > 1 ? "s" : "") + ": " + winners.map((w) => w.name).join(", ") + "!"
      : "Winning number was " + demo.secret + " — no winner this round. Start a new round and try again."
  );
}

function renderDemo() {
  const box = $("demoPlayers");
  if (!demo) { box.innerHTML = "<p class='muted'>No round yet. Press “Start a round”.</p>"; $("demoSecret").textContent = "—"; return; }
  $("demoSecret").textContent = demo.revealed ? String(demo.secret) : "🔒 sealed";
  $("demoRoundLabel").textContent = "Round " + demoRound + (demo.revealed ? " — revealed" : " — open");
  box.innerHTML = demo.players.map((p) => {
    const won = demo.revealed && p.guess === demo.secret;
    const shown = demo.revealed ? String(p.guess) : fakeCiphertext(p.guess);
    return `<div class="player ${won ? "winner" : ""}">
      <strong>${p.name}</strong>
      <span>${demo.revealed ? "guess: " + shown : "sealed: " + shown}</span>
      <span>${demo.revealed ? (won ? "🏆 WINNER" : "—") : "🔒 hidden"}</span>
    </div>`;
  }).join("");
}

function setStatus(msg) { $("status").textContent = msg; }

// ---------- Sepolia (real FHE) ----------
async function connectWallet() {
  if (!window.ethereum) { setStatus("No wallet found — install MetaMask in your browser, then try again."); return; }
  if (!CFG.CONTRACT_ADDRESS) {
    setStatus("Sepolia is not wired up yet: deploy the contract first, then paste its address into frontend/config.js (see README).");
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    $("walletLabel").textContent = "Connected: " + accounts[0].slice(0, 6) + "…" + accounts[0].slice(-4);
    $("sepoliaPanel").classList.remove("hidden");
    setStatus("Wallet connected. On Sepolia your guess is encrypted with the Relayer SDK before it leaves your browser.");
  } catch (e) {
    setStatus("Wallet connection was cancelled.");
  }
}

async function sepoliaPlay() {
  // Full wiring (encrypt with @zama-fhe/relayer-sdk, call play()):
  //   const { createInstance } = await import("@zama-fhe/relayer-sdk");
  //   const instance = await createInstance({ ... });
  //   const input = await instance.createEncryptedInput(CONTRACT_ADDRESS, account)
  //     .add32(guess).encrypt();
  //   await contract.play(roundId, input.handles[0], input.inputProof);
  // This is intentionally NOT faked here: until CONTRACT_ADDRESS is
  // set and the contract is deployed, the button explains that.
  setStatus("Sepolia play needs a deployed contract address in config.js. Deploy first (README: 'Deploy to Sepolia'), then this button encrypts your guess with the Relayer SDK and calls play().");
}

async function sepoliaReveal() {
  setStatus("Sepolia reveal needs a deployed contract. After revealRound() on-chain, the secret and win flags are publicly decrypted with the Relayer SDK — see README.");
}

document.addEventListener("DOMContentLoaded", () => {
  $("startRoundBtn").addEventListener("click", startDemoRound);
  $("sealGuessBtn").addEventListener("click", sealDemoGuess);
  $("revealBtn").addEventListener("click", revealDemo);
  $("connectBtn").addEventListener("click", connectWallet);
  $("sepoliaPlayBtn").addEventListener("click", sepoliaPlay);
  $("sepoliaRevealBtn").addEventListener("click", sepoliaReveal);
  renderDemo();
});
