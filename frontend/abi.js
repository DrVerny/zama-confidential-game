// SealedFortune contract ABI - only the functions the frontend needs.
// Generated from contracts/SealedFortune.sol. Keep in sync after any
// contract change (re-run: npx hardhat compile, then copy the ABI).
window.SEALED_FORTUNE_ABI = [
  "function startRound() returns (uint256 roundId)",
  "function play(uint256 roundId, bytes32 encryptedGuess, bytes inputProof)",
  "function revealRound(uint256 roundId)",
  "function rounds(uint256) view returns (uint256 id, address creator, uint256 createdAt, uint256 revealAfter, bool revealed, uint256 playerCount)",
  "function hasPlayed(uint256, address) view returns (bool)",
  "function getSecret(uint256) view returns (bytes32)",
  "function getGuess(uint256, address) view returns (bytes32)",
  "function getWinFlag(uint256, address) view returns (bytes32)",
  "function getPlayers(uint256) view returns (address[])",
  "function nextRoundId() view returns (uint256)",
  "event RoundStarted(uint256 indexed roundId, address indexed creator, uint256 revealAfter)",
  "event GuessSealed(uint256 indexed roundId, address indexed player)",
  "event RoundRevealed(uint256 indexed roundId)",
];
