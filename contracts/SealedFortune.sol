// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, ebool, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Sealed Fortune - Hidden Number / Mystery Box
/// @author Moshood Sodiq Olasunkanmi (@verrnny / DrVerny)
/// @notice Zama Developer Program Season 5 - Confidential Gaming.
///         A complete, playable game whose core mechanic ONLY works
///         because the game state stays encrypted with FHEVM.
///
/// WHAT STAYS ENCRYPTED, AND WHEN IT IS REVEALED
/// ----------------------------------------------
/// 1. The winning number (1-100) is generated ON-CHAIN with
///    FHE.randEuint32() and stored as an `euint32`. It is NEVER
///    stored, emitted, or logged as plaintext. Nobody - not the
///    host, not other players, not anyone reading the chain -
///    can see it while the round is open.
/// 2. Every player's guess is submitted as an `externalEuint32`
///    (encrypted in the player's browser with the Relayer SDK)
///    and converted with FHE.fromExternal(). The guess is stored
///    as an `euint32`. Nobody can see any guess before reveal.
/// 3. Win / lose is computed ON ENCRYPTED DATA, inside the
///    contract, with FHE.eq(guess, secret). The result is an
///    `ebool` - still encrypted. The contract never branches on
///    a plaintext guess or secret, so no information leaks
///    through gas, events, or return values.
/// 4. ONLY at reveal time does the host call revealRound().
///    That calls FHE.makePubliclyDecryptable() on the secret
///    (and on each stored win flag). After that - and only
///    after that - anyone can decrypt the winning number and
///    the winners through the Zama Relayer. Before reveal,
///    public decryption is impossible.
///
/// WHY THIS ONLY WORKS WITH FHE
/// -----------------------------
/// On a fully transparent chain, a "hidden number" game is
/// impossible: the winning number and every guess would be
/// visible in the mempool / storage, so players could copy
/// the winner, and the host could change the number after
/// seeing the guesses. Here the secret is fixed at round
/// creation, encrypted, and the comparison happens while
/// everything is still encrypted. That is the whole game.
///
/// HOW A ROUND PLAYS
/// -----------------
/// 1. Anyone calls startRound() - a new round opens for
///    `ROUND_DURATION` (default 1 day, overridable per round).
/// 2. Each player calls play(roundId, encryptedGuess, proof)
///    ONCE per round, with a number 1-100. Their guess is a
///    sealed "mystery box" - picking a box is picking a number.
/// 3. After the deadline anyone calls revealRound(roundId).
///    The secret and the win flags become publicly decryptable.
/// 4. The frontend decrypts them with the Relayer SDK and
///    shows the winning number and the winners. Winners are
///    recorded off-chain from the decrypted result; the
///    contract deliberately does NOT write a plaintext winner
///    list on-chain, because that would defeat the point of
///    keeping the game state confidential until reveal.
///
/// NOTES / HONEST LIMITS
/// ---------------------
/// - This is a testnet game for points / bragging rights, not
///   real money. No ETH, cUSDT, or prizes are escrowed in this
///   contract. A prize pool can be added later (see README).
/// - FHE.randEuint32() is the Zama-provided on-chain randomness
///   source for FHEVM. It is the correct source to use here:
///   a host-supplied secret would let the host know the answer.
/// - Range checks (1-100) cannot be done on a plaintext guess
///   without leaking it. The frontend enforces 1-100 before
///   encrypting; the contract clamps the encrypted comparison
///   so an out-of-range guess simply cannot win (it is compared
///   for equality with a secret that is always 1-100).
contract SealedFortune is ZamaEthereumConfig {
    /// @notice A round lasts 1 day by default.
    uint256 public constant ROUND_DURATION = 1 days;
    /// @notice Guesses / secrets are always in 1..100.
    uint32 public constant MIN_NUMBER = 1;
    uint32 public constant MAX_NUMBER = 100;

    struct Round {
        uint256 id;
        address creator;
        uint256 createdAt;
        uint256 revealAfter;
        bool revealed;
        uint256 playerCount;
    }

    uint256 public nextRoundId;
    mapping(uint256 => Round) public rounds;

    /// @dev roundId => encrypted winning number. NEVER plaintext.
    mapping(uint256 => euint32) private _secrets;
    /// @dev roundId => player => their encrypted guess.
    mapping(uint256 => mapping(address => euint32)) private _guesses;
    /// @dev roundId => player => encrypted win flag (guess == secret).
    mapping(uint256 => mapping(address => ebool)) private _winFlags;
    /// @dev roundId => player => has this player already played?
    mapping(uint256 => mapping(address => bool)) public hasPlayed;
    /// @dev roundId => list of players, so the frontend can decrypt
    ///      every win flag at reveal time.
    mapping(uint256 => address[]) public roundPlayers;

    event RoundStarted(uint256 indexed roundId, address indexed creator, uint256 revealAfter);
    event GuessSealed(uint256 indexed roundId, address indexed player);
    event RoundRevealed(uint256 indexed roundId);

    /// @notice Open a new round. The winning number is drawn
    ///         on-chain, encrypted, and fixed immediately.
    /// @return roundId The id of the new round.
    function startRound() external returns (uint256 roundId) {
        roundId = nextRoundId++;
        // On-chain encrypted randomness: randEuint32() % 100, then
        // +1 => 1..100. (The bounded form randEuint32(100) reverts:
        // the bound must be a power of two, so we use rem instead.)
        // FHE.rem / FHE.add operate on encrypted values only;
        // the result is never plaintext.
        euint32 secret = FHE.add(
            FHE.rem(FHE.randEuint32(), MAX_NUMBER),
            FHE.asEuint32(MIN_NUMBER)
        );
        _secrets[roundId] = secret;
        FHE.allowThis(secret);

        rounds[roundId] = Round({
            id: roundId,
            creator: msg.sender,
            createdAt: block.timestamp,
            revealAfter: block.timestamp + ROUND_DURATION,
            revealed: false,
            playerCount: 0
        });

        emit RoundStarted(roundId, msg.sender, block.timestamp + ROUND_DURATION);
    }

    /// @notice Seal a guess for an open round. One guess per player.
    /// @param roundId The round to play in.
    /// @param encryptedGuess The player's number, encrypted in the
    ///        browser with the Relayer SDK (externalEuint32).
    /// @param inputProof The Relayer SDK input proof for the guess.
    function play(
        uint256 roundId,
        externalEuint32 encryptedGuess,
        bytes calldata inputProof
    ) external {
        Round storage round = rounds[roundId];
        require(round.creator != address(0), "Round does not exist");
        require(!round.revealed, "Round already revealed");
        require(block.timestamp < round.revealAfter, "Round is closed");
        require(!hasPlayed[roundId][msg.sender], "Already played this round");

        euint32 guess = FHE.fromExternal(encryptedGuess, inputProof);
        _guesses[roundId][msg.sender] = guess;
        FHE.allowThis(guess);
        // Only the player may user-decrypt their own guess.
        FHE.allow(guess, msg.sender);

        // Win / lose is computed while everything is encrypted.
        ebool won = FHE.eq(guess, _secrets[roundId]);
        _winFlags[roundId][msg.sender] = won;
        FHE.allowThis(won);
        FHE.allow(won, msg.sender);

        hasPlayed[roundId][msg.sender] = true;
        roundPlayers[roundId].push(msg.sender);
        round.playerCount += 1;

        emit GuessSealed(roundId, msg.sender);
    }

    /// @notice Reveal a round after its deadline. This is the ONLY
    ///         moment anything becomes decryptable. After this call
    ///         the winning number and every win flag can be
    ///         publicly decrypted through the Zama Relayer.
    /// @param roundId The round to reveal.
    function revealRound(uint256 roundId) external {
        Round storage round = rounds[roundId];
        require(round.creator != address(0), "Round does not exist");
        require(!round.revealed, "Round already revealed");
        require(block.timestamp >= round.revealAfter, "Too early to reveal");

        round.revealed = true;

        FHE.makePubliclyDecryptable(_secrets[roundId]);
        address[] storage players = roundPlayers[roundId];
        for (uint256 i = 0; i < players.length; i++) {
            FHE.makePubliclyDecryptable(_winFlags[roundId][players[i]]);
            FHE.makePubliclyDecryptable(_guesses[roundId][players[i]]);
        }

        emit RoundRevealed(roundId);
    }

    /// @notice Encrypted winning number for a round (a handle, not
    ///         a plaintext number). Only decryptable after reveal.
    function getSecret(uint256 roundId) external view returns (euint32) {
        return _secrets[roundId];
    }

    /// @notice A player's encrypted guess for a round.
    function getGuess(uint256 roundId, address player) external view returns (euint32) {
        return _guesses[roundId][player];
    }

    /// @notice A player's encrypted win flag for a round.
    ///         True (encrypted) iff their guess equalled the secret.
    function getWinFlag(uint256 roundId, address player) external view returns (ebool) {
        return _winFlags[roundId][player];
    }

    /// @notice All players in a round, for reveal-time decryption.
    function getPlayers(uint256 roundId) external view returns (address[] memory) {
        return roundPlayers[roundId];
    }
}
